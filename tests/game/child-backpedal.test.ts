import assert from 'node:assert/strict';
import test from 'node:test';
import { MATCH_RULES, MatchEngine } from '../../src/game/MatchEngine';

test('backpedalling preserves aim and damages a ghost in front of the light', () => {
  const engine = new MatchEngine({
    seed: 7,
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
    map: {
      id: 'backpedal-test',
      bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
      walls: [],
      ghostSpawn: { x: 1.5, z: 0 },
      childSpawns: [{ x: 0, z: 0 }, { x: 8, z: 8 }, { x: -8, z: 8 }, { x: 8, z: -8 }],
      batterySpawns: [{ x: 4, z: 4 }],
    },
  });
  const checkpoint = engine.checkpoint();
  const child = checkpoint.players.find((player) => player.id === 'child')!;
  const before = { ...child.position };
  engine.advance([{ playerId: 'child', move: { x: -1, z: 0 }, facingRadians: 0, action: true }], 6);
  const after = engine.checkpoint();
  const moved = after.players.find((player) => player.id === 'child')!;
  assert.ok(moved.position.x < before.x);
  assert.equal(moved.facingRadians, 0);
  assert.ok(after.ghostHealth < MATCH_RULES.ghostMaxHealth);
});
