import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Exercise the actual ArkTS service with only platform boundaries replaced.
const source = readFileSync(new URL('../../prototypes/harmony-gate-a/entry/src/main/ets/services/GameService.ets', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function deferred() {
  let resolve!: () => void;
  let reject!: (error: { code: number }) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(buildProfile = { DEBUG: false, PRODUCT_NAME: 'release' }) {
  const state = new Map<string, string>();
  const calls: string[] = [];
  let changed: ((result: { event: number }) => void) | undefined;
  const verification = deferred();
  const exports = {} as { gameService: { start(context: object): void; retry(): void; stop(): void } };
  const gamePlayer = {
    init: async () => { calls.push('init'); },
    unionLogin: async (_context: object, options: { showLoginDialog: boolean }) => {
      calls.push(options.showLoginDialog ? 'login:explicit' : 'login');
      return { accountName: 'hw_account' };
    },
    verifyLocalPlayer: (_context: object, request: { thirdOpenId: string }) => {
      assert.equal(request.thirdOpenId, '');
      assert.equal(Object.keys(request).length, 1);
      calls.push('verify');
      return verification.promise;
    },
    PlayerChangedEvent: { SWITCH_GAME_ACCOUNT: 0 },
    on: (_event: string, callback: typeof changed) => { changed = callback; },
    off: () => { changed = undefined; },
  };
  runInNewContext(code, {
    exports,
    AppStorage: { setOrCreate: (key: string, value: string) => state.set(key, value) },
    require: (name: string) => {
      if (name === 'entry/BuildProfile') return { __esModule: true, default: buildProfile };
      if (name === '@kit.GameServiceKit') return { gamePlayer };
      if (name === '@kit.PerformanceAnalysisKit') return { hilog: { info() {}, error() {} } };
      if (name === '../network/LanHostProbe') return { lanHostProbe: { stop: async () => { calls.push('stopLan'); } } };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { service: exports.gameService, state, calls, verification, gamePlayer, switchAccount: () => changed?.({ event: 0 }) };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('explicit local debug build enters without calling Huawei game services', async () => {
  const h = harness({ DEBUG: true, PRODUCT_NAME: 'local' });
  h.service.start({});
  await settle();
  assert.equal(h.state.get('gameServiceState'), 'ready');
  assert.deepEqual(h.calls, []);
  h.service.stop();
  assert.equal(h.state.get('gameServiceState'), 'checking');
  h.service.start({});
  h.service.retry();
  await settle();
  assert.equal(h.state.get('gameServiceState'), 'ready');
  assert.deepEqual(h.calls, []);
});

for (const profile of [
  { DEBUG: false, PRODUCT_NAME: 'local' },
  { DEBUG: true, PRODUCT_NAME: 'release' },
  { DEBUG: true, PRODUCT_NAME: 'default' },
]) {
  test(`${profile.PRODUCT_NAME}/${profile.DEBUG ? 'debug' : 'release'} still requires verification`, async () => {
    const h = harness(profile);
    h.service.start({});
    await settle();
    assert.deepEqual(h.calls, ['init', 'login', 'verify']);
    assert.equal(h.state.get('gameServiceState'), 'checking');
    h.verification.reject({ code: 1002000001 });
    await settle();
    assert.equal(h.state.get('gameServiceState'), 'error');
  });
}

test('game remains gated until initialization, login and verification complete', async () => {
  const h = harness();
  h.service.start({});
  h.service.retry();
  await settle();
  assert.deepEqual(h.calls, ['init', 'login', 'verify']);
  assert.equal(h.state.get('gameServiceState'), 'checking');
  h.verification.resolve();
  await settle();
  assert.equal(h.state.get('gameServiceState'), 'ready');
});

test('verification failure blocks play without automatically reopening login', async () => {
  const h = harness();
  h.service.start({});
  await settle();
  h.verification.reject({ code: 1002000006 });
  await settle();
  assert.equal(h.state.get('gameServiceState'), 'error');
  assert.match(h.state.get('gameServiceMessage')!, /允许的游戏时间/);
  assert.equal(h.calls.filter((call) => call === 'login').length, 1);
});

test('cancelled login can be retried manually without verifying the cancelled attempt', async () => {
  const h = harness();
  const login = h.gamePlayer.unionLogin;
  h.gamePlayer.unionLogin = async () => { throw { code: 1002000016 }; };
  h.service.start({});
  await settle();
  assert.equal(h.state.get('gameServiceState'), 'error');
  assert.deepEqual(h.calls, ['init']);
  h.gamePlayer.unionLogin = login;
  h.service.retry();
  h.verification.resolve();
  await settle();
  assert.equal(h.state.get('gameServiceState'), 'ready');
});

test('account switch invalidates pending verification and explicitly logs in again', async () => {
  const h = harness();
  h.service.start({});
  await settle();
  const next = deferred();
  h.gamePlayer.verifyLocalPlayer = () => next.promise;
  h.switchAccount();
  h.verification.resolve();
  await settle();
  assert.equal(h.state.get('gameServiceState'), 'checking');
  assert.ok(h.calls.includes('stopLan'));
  assert.ok(h.calls.includes('login:explicit'));
  next.resolve();
  await settle();
  assert.equal(h.state.get('gameServiceState'), 'ready');
});

test('destroyed ability cannot be unlocked by a late verification result', async () => {
  const h = harness();
  h.service.start({});
  await settle();
  h.service.stop();
  h.verification.resolve();
  await settle();
  assert.equal(h.state.get('gameServiceState'), 'checking');
  h.switchAccount();
  assert.ok(!h.calls.includes('login:explicit'));
});

test('initialization failure prevents login and can be retried', async () => {
  const h = harness();
  const init = h.gamePlayer.init;
  h.gamePlayer.init = async () => { throw { code: 1002000002 }; };
  h.service.start({});
  await settle();
  assert.equal(h.state.get('gameServiceState'), 'error');
  assert.deepEqual(h.calls, []);
  h.gamePlayer.init = init;
  h.service.retry();
  h.verification.resolve();
  await settle();
  assert.equal(h.state.get('gameServiceState'), 'ready');
});

test('a new ability waits for the obsolete attempt before starting its own login', async () => {
  const h = harness();
  h.service.start({});
  await settle();
  h.service.stop();
  const next = deferred();
  h.gamePlayer.verifyLocalPlayer = () => next.promise;
  h.service.start({});
  h.verification.resolve();
  await settle();
  assert.equal(h.state.get('gameServiceState'), 'checking');
  assert.equal(h.calls.filter((call) => call === 'init').length, 2);
  next.resolve();
  await settle();
  assert.equal(h.state.get('gameServiceState'), 'ready');
});
