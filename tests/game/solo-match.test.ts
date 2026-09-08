import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_HOUSE_MAP } from '../../src/game/defaultHouse';
import { GridNavigator } from '../../src/game/GridNavigator';
import { MATCH_RULES, MatchEngine, type MatchMap } from '../../src/game/MatchEngine';
import { SoloBot } from '../../src/game/SoloBot';
import { SoloMatch } from '../../src/game/SoloMatch';
import { projectViewerFrame } from '../../src/game/ViewerProjection';

const idle = { x: 0, z: 0 };
const openMap: MatchMap = {
  id: 'solo-test', bounds: { minX: -12, maxX: 12, minZ: -12, maxZ: 12 }, walls: [],
  ghostSpawn: { x: 3, z: 0 },
  childSpawns: [{ x: 0, z: 0 }, { x: 0, z: 4 }, { x: 0, z: -4 }, { x: -4, z: 0 }],
  batterySpawns: [{ x: -3, z: -3 }, { x: 3, z: 3 }],
};

test('solo supports both roles, one to four children, and sensor dolls only in empty slots', () => {
  for (const role of ['ghost', 'child'] as const) {
    for (let childCount = 1; childCount <= 4; childCount += 1) {
      const match = new SoloMatch(openMap, { role, childCount, seed: 71 });
      const frame = match.frame();
      assert.equal(frame.viewerRole, role);
      assert.equal(frame.children.length, childCount);
      assert.equal(frame.dolls.length, 4 - childCount);
      assert.equal(frame.remainingTicks, MATCH_RULES.matchDurationTicks);
    }
  }
  assert.throws(() => new SoloMatch(openMap, { role: 'ghost', childCount: 0, seed: 1 }), RangeError);
});

test('pause freezes authority, input and events; resume does not catch up elapsed time', () => {
  const match = new SoloMatch(openMap, { role: 'child', childCount: 2, seed: 71 });
  match.update(0.1, idle, 0, true);
  match.drainEvents();
  const before = match.frame();
  match.setPaused(true);
  assert.deepEqual(match.update(100, { x: 1, z: 1 }, 2, true), before);
  assert.deepEqual(match.drainEvents(), []);
  match.setPaused(false);
  assert.equal(match.update(1 / 60, idle, 0, false).tick, before.tick + 1);
});

test('fixed steps are deterministic across render rates and a new match clears progress', () => {
  const options = { role: 'ghost' as const, childCount: 4, seed: 71 };
  const fast = new SoloMatch(openMap, options);
  const slow = new SoloMatch(openMap, options);
  for (let index = 0; index < 120; index += 1) fast.update(1 / 60, idle, 0, false);
  for (let index = 0; index < 20; index += 1) slow.update(0.1, idle, 0, false);
  assert.deepEqual(fast.frame(), slow.frame());
  const fresh = new SoloMatch(openMap, options).frame();
  assert.equal(fresh.tick, 0);
  assert.equal(fresh.captureCount, 0);
  assert.equal(fresh.ghostHealth, MATCH_RULES.ghostMaxHealth);
  assert.equal(fresh.children.every((child) => child.batteryCharge === 1 && !child.flashlightOn), true);
});

test('a warning band cannot reveal a hidden ghost direction to a child bot', () => {
  const engine = new MatchEngine({ map: openMap, seed: 71, ghostPlayerId: 'ghost', childPlayerIds: ['child'] });
  const left = engine.checkpoint();
  const right = structuredClone(left);
  left.players[0].position = { x: -3, z: 0 };
  right.players[0].position = { x: 3, z: 0 };
  const first = projectViewerFrame(left, 'child');
  const second = projectViewerFrame(right, 'child');
  assert.deepEqual(first, second);
  assert.equal(first.ghost, undefined);
  const navigator = new GridNavigator(openMap);
  const botA = new SoloBot('child', openMap, navigator, 1);
  const botB = new SoloBot('child', openMap, navigator, 1);
  assert.deepEqual(botA.command(first), botB.command(second));
});

test('after losing sight, bots search the last seen location without tracking through walls', () => {
  const map = { ...openMap, walls: [{ id: 'divider', minX: 4, maxX: 4.3, minZ: -12, maxZ: 12 }] };
  const engine = new MatchEngine({ map, seed: 71, ghostPlayerId: 'ghost', childPlayerIds: ['child'] });
  const checkpoint = engine.checkpoint();
  checkpoint.players[0].position = { x: 0, z: 0 };
  checkpoint.players[1].position = { x: 2, z: 2 };
  const navigator = new GridNavigator(map);
  const botA = new SoloBot('ghost', map, navigator, 1);
  const botB = new SoloBot('ghost', map, navigator, 1);
  botA.command(projectViewerFrame(checkpoint, 'ghost'));
  botB.command(projectViewerFrame(checkpoint, 'ghost'));
  checkpoint.tick = 15;
  checkpoint.players[1].position = { x: 6, z: 5 };
  const commandA = botA.command(projectViewerFrame(checkpoint, 'ghost'));
  checkpoint.players[1].position = { x: 6, z: -5 };
  assert.deepEqual(commandA, botB.command(projectViewerFrame(checkpoint, 'ghost')));
  assert.ok(commandA.move.z > 0, 'search heads toward the last seen positive z');
});

test('ghost patrols from every initial waypoint without sticking to a doorway edge', () => {
  for (let seed = 0; seed < 5 + DEFAULT_HOUSE_MAP.batterySpawns.length; seed += 1) {
    const match = new SoloMatch(DEFAULT_HOUSE_MAP, { role: 'child', childCount: 1, seed });
    let frame = match.frame();
    for (let index = 0; index < 1200 && frame.phase !== 'ended'; index += 1) {
      frame = match.update(0.1, idle, 0, false);
      match.drainEvents();
    }
    assert.equal(frame.winner, 'ghost', `patrol seed ${seed} must reach the idle child after every reset`);
  }
});

test('real house solo matches progress and terminate for both roles with 1–4 children', () => {
  for (const role of ['ghost', 'child'] as const) {
    for (let childCount = 1; childCount <= 4; childCount += 1) {
      const match = new SoloMatch(DEFAULT_HOUSE_MAP, { role, childCount, seed: 71 });
      let frame = match.frame();
      let firstProgressTick: number | null = null;
      let endEvents = 0;
      let captures = 0;
      for (let index = 0; index < 3300 && frame.phase !== 'ended'; index += 1) {
        frame = match.update(0.1, idle, 0, false);
        if (frame.captureCount || frame.ghostHealth < MATCH_RULES.ghostMaxHealth) firstProgressTick ??= frame.tick;
        for (const event of match.drainEvents()) {
          if (event.type === 'match-ended') endEvents += 1;
          if (event.type === 'child-captured') captures += 1;
        }
      }
      assert.equal(frame.phase, 'ended', `${role}/${childCount} terminates`);
      assert.equal(endEvents, 1);
      assert.equal(captures, frame.captureCount);
      if (role === 'child' && childCount === 1) {
        assert.equal(frame.winner, 'ghost', 'an idle child cannot win through a bot navigation stall after reset');
        assert.equal(captures, 3);
      }
      assert.ok(firstProgressTick !== null && firstProgressTick < 60 * MATCH_RULES.tickRate,
        `${role}/${childCount} has real opposition in the first minute, got ${firstProgressTick}`);
      const ended = match.frame();
      assert.deepEqual(match.update(0.1, { x: 1, z: 0 }, 0, true), ended);
    }
  }
});
