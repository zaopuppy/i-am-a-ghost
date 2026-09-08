import assert from 'node:assert/strict';
import test from 'node:test';
import { childHipOffset, childMovementMultiplier } from '../../src/game/ChildMovement';
import { MatchEngine } from '../../src/game/MatchEngine';

test('directional speed is continuous, magnitude independent and uses torso facing', () => {
  assert.equal(childMovementMultiplier({ x: 1, z: 0 }, 0), 1);
  assert.equal(childMovementMultiplier({ x: 1, z: 0 }, Math.PI / 2), 0.95);
  assert.ok(Math.abs(childMovementMultiplier({ x: 1, z: 0 }, Math.PI) - 0.9) < 1e-9);
  assert.equal(childMovementMultiplier({ x: 0.2, z: 0 }, Math.PI / 2), 0.95);
  assert.ok(childMovementMultiplier({ x: 1, z: 1 }, 0) > 0.95);
  assert.ok(childMovementMultiplier({ x: -1, z: 1 }, 0) < 0.95);
  assert.equal(childMovementMultiplier({ x: 0, z: 0 }, 0), 1);
});

test('hip turn peaks at 45 degrees on each side and returns to neutral on retreat', () => {
  assert.equal(childHipOffset({ x: 0, z: 1 }, 0), Math.PI / 4);
  assert.equal(childHipOffset({ x: 0, z: -1 }, 0), -Math.PI / 4);
  assert.equal(childHipOffset({ x: -1, z: 0 }, 0), 0);
  assert.equal(childHipOffset({ x: 1, z: 0 }, 0), 0);
  assert.ok(Math.abs(childHipOffset({ x: -1, z: 0.001 }, 0)) < 0.001);
});

test('authority applies forward, sideways and backward speeds even when illumination is not active', () => {
  for (const [facingRadians, multiplier] of [[0, 1], [Math.PI / 2, 0.95], [Math.PI, 0.9]]) {
    const engine = new MatchEngine({
      seed: 7, ghostPlayerId: 'ghost', childPlayerIds: ['child'],
      map: {
        id: 'direction-speed-test',
        bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
        walls: [],
        ghostSpawn: { x: -10, z: -10 },
        childSpawns: [{ x: 0, z: 0 }, { x: 8, z: 8 }, { x: -8, z: 8 }, { x: 8, z: -8 }],
        batterySpawns: [{ x: 4, z: 4 }],
      },
    });
    engine.advance([{ playerId: 'child', move: { x: 1, z: 0 }, facingRadians, action: false }]);
    const child = engine.checkpoint().players.find((player) => player.id === 'child')!;
    assert.ok(Math.abs(child.position.x - 3.6 / 60 * multiplier) < 1e-9);
  }
});
