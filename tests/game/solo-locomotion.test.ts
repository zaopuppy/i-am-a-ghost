import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_HOUSE_MAP } from '../../src/game/defaultHouse';
import { GridNavigator } from '../../src/game/GridNavigator';
import { MatchEngine, type Vec2 } from '../../src/game/MatchEngine';
import { SoloBot } from '../../src/game/SoloBot';
import { projectViewerFrame } from '../../src/game/ViewerProjection';
import { SoloMatch } from '../../src/game/SoloMatch';

test('solo presentation keeps straight walking continuous between fixed simulation ticks', () => {
  for (const delta of [0.016, 1 / 144]) {
    const match = new SoloMatch(DEFAULT_HOUSE_MAP, { role: 'ghost', childCount: 1, seed: 71 });
    let previous = match.frame().ghost!.position.x;
    for (let index = 0; index < 30; index += 1) {
      match.update(delta, { x: 1, z: 0 }, 0, false);
      const frame = match.presentationFrame();
      const position = frame.ghost!.position.x;
      if (index > 2) assert.ok(Math.abs((position - previous) / delta - 3.96) < 1e-6,
        `walking speed jumped at render frame ${index} (${delta}s)`);
      previous = position;
    }
  }
});

test('pausing preserves the displayed fractional step and resume does not snap', () => {
  const match = new SoloMatch(DEFAULT_HOUSE_MAP, { role: 'ghost', childCount: 1, seed: 71 });
  match.update(0.025, { x: 1, z: 0 }, 0, false);
  const before = match.presentationFrame();
  const authority = match.frame();
  match.setPaused(true);
  match.update(10, { x: 1, z: 0 }, 0, false);
  assert.deepEqual(match.presentationFrame(), before);
  assert.deepEqual(match.frame(), authority);
  match.setPaused(false);
  match.update(0.005, { x: 1, z: 0 }, 0, false);
  assert.ok(Math.abs(match.presentationFrame().ghost!.position.x - before.ghost!.position.x - 3.96 * 0.005) < 1e-6);
});

test('a fixed destination never makes a walking actor double back at a route refresh', () => {
  const engine = new MatchEngine({ map: DEFAULT_HOUSE_MAP, seed: 71, ghostPlayerId: 'ghost', childPlayerIds: ['child'] });
  const navigator = new GridNavigator(DEFAULT_HOUSE_MAP);
  let previous: Vec2 | null = null;
  for (let tick = 0; tick < 60; tick += 1) {
    const position = engine.checkpoint().players[0].position;
    const move = navigator.moveToward('ghost', position, DEFAULT_HOUSE_MAP.childSpawns[0], tick);
    if (previous) assert.ok(move.x * previous.x + move.z * previous.z >= -0.5, `unrequested reversal at tick ${tick}`);
    engine.advance([{ playerId: 'ghost', move, facingRadians: Math.atan2(move.z, move.x), action: false }]);
    previous = move;
  }
});

test('AI turns continuously instead of snapping its body on decision ticks', () => {
  const engine = new MatchEngine({ map: DEFAULT_HOUSE_MAP, seed: 71, ghostPlayerId: 'ghost', childPlayerIds: ['child'] });
  const bot = new SoloBot('child', DEFAULT_HOUSE_MAP, new GridNavigator(DEFAULT_HOUSE_MAP), 9);
  for (let tick = 0; tick < 180; tick += 1) {
    const before = engine.checkpoint();
    const own = before.players.find((player) => player.id === 'child')!;
    const command = bot.command(projectViewerFrame(before, 'child'));
    const turn = Math.abs(Math.atan2(Math.sin(command.facingRadians - own.facingRadians), Math.cos(command.facingRadians - own.facingRadians)));
    assert.ok(turn <= 5 / 60 + 1e-6, `body snapped by ${(turn * 180 / Math.PI).toFixed(1)} degrees in one frame`);
    engine.advance([command]);
  }
});

test('approaching a close target stops without oscillating across it', () => {
  const engine = new MatchEngine({ map: DEFAULT_HOUSE_MAP, seed: 71, ghostPlayerId: 'ghost', childPlayerIds: ['child'] });
  const navigator = new GridNavigator(DEFAULT_HOUSE_MAP);
  const goal = { x: 0.4, z: 0 };
  for (let tick = 0; tick < 60; tick += 1) {
    const position = engine.checkpoint().players[0].position;
    const move = navigator.moveToward('ghost', position, goal, tick);
    assert.ok(move.x >= 0, 'arrival must not bounce backwards across its target');
    engine.advance([{ playerId: 'ghost', move, facingRadians: 0, action: false }]);
  }
});
