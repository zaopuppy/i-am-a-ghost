import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveConfig } from 'vite';

test('Harmony release build disables browser source maps', async () => {
  const config = await resolveConfig({
    configFile: path.resolve('vite.config.ts'),
  }, 'build', 'harmony-release');

  assert.equal(config.build.sourcemap, false);
  assert.equal(config.build.minify, 'esbuild');
  assert.deepEqual(config.esbuild.drop, ['console', 'debugger']);
});

test('Harmony release command selects both web and native release modes', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assert.match(packageJson.scripts?.['build:harmony-release'] ?? '', /--mode harmony-release/);
  assert.match(packageJson.scripts?.['prototype:harmony:release'] ?? '', /--build-mode release/);
  assert.equal(packageJson.scripts?.['prototype:harmony:build'], 'npm run prototype:harmony:release');
  assert.match(packageJson.scripts?.['prototype:harmony:local'] ?? '', /--product local --build-mode debug/);
  assert.match(packageJson.scripts?.['prototype:harmony:run'] ?? '', /--product local --build-mode debug --skip-build/);
});

test('Harmony LAN pauses in background and resumes only after in-process consent', async () => {
  const abilitySource = await readFile(
    'prototypes/harmony-gate-a/entry/src/main/ets/entryability/EntryAbility.ets',
    'utf8',
  );
  const probeSource = await readFile(
    'prototypes/harmony-gate-a/entry/src/main/ets/network/LanHostProbe.ets',
    'utf8',
  );

  assert.match(abilitySource, /onForeground\(\): void \{[\s\S]*?lanHostProbe\.resume\(this\.context\)/);
  assert.match(abilitySource, /onBackground\(\): void \{[\s\S]*?lanHostProbe\.pause\(this\.context\)/);
  assert.match(probeSource, /private consentGranted: boolean = false;/);
  assert.match(probeSource, /start\([^)]*\)[\s\S]*?this\.consentGranted = true;[\s\S]*?this\.resume\(context\)/);
  assert.match(probeSource, /stop\([^)]*\)[\s\S]*?this\.consentGranted = false;/);
});
