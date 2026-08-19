import assert from 'node:assert/strict';
import test from 'node:test';
import { mapPositionIsOpen, mapSegmentIsOpen } from '../../src/game/MapCollision';
import {
  MATCH_RULES,
  MatchEngine,
  type MatchMap,
} from '../../src/game/MatchEngine';
import { movePredictedPosition } from '../../src/net/FramePresenter';

const FURNISHED_MAP: MatchMap = {
  id: 'furnished-test-map',
  bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
  walls: [],
  movementObstacles: [{
    id: 'rotated-table',
    center: { x: 0, z: 0 },
    halfWidth: 1,
    halfDepth: 0.25,
    yawRadians: Math.PI / 4,
  }],
  ghostSpawn: { x: 2, z: 0 },
  childSpawns: [
    { x: -2, z: 0 },
    { x: 3, z: 3 },
    { x: -3, z: 3 },
    { x: 3, z: -3 },
  ],
  batterySpawns: [{ x: 0, z: 3 }],
};

test('map collision accepts open floor and rejects a rotated furniture footprint', () => {
  assert.equal(mapPositionIsOpen(FURNISHED_MAP, { x: 3, z: 0 }, MATCH_RULES.playerRadius), true);
  assert.equal(mapPositionIsOpen(FURNISHED_MAP, { x: 0, z: 0 }, MATCH_RULES.playerRadius), false);
  assert.equal(
    mapSegmentIsOpen(FURNISHED_MAP, { x: -2, z: -2 }, { x: 2, z: 2 }, MATCH_RULES.playerRadius),
    false,
  );
});

test('authoritative movement slides against furniture without treating it as a flashlight wall', () => {
  const map: MatchMap = {
    ...FURNISHED_MAP,
    movementObstacles: [{
      id: 'cabinet',
      center: { x: 0, z: 0 },
      halfWidth: 0.2,
      halfDepth: 1,
      yawRadians: 0,
    }],
    ghostSpawn: { x: 1.5, z: 0 },
    childSpawns: [
      { x: -1.5, z: 0 },
      FURNISHED_MAP.childSpawns[1],
      FURNISHED_MAP.childSpawns[2],
      FURNISHED_MAP.childSpawns[3],
    ],
  };
  const engine = new MatchEngine({
    seed: 91,
    map,
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  engine.advance([
    { playerId: 'child', move: { x: 1, z: 0 }, facingRadians: 0, action: true },
  ], MATCH_RULES.tickRate);

  const checkpoint = engine.checkpoint();
  const child = checkpoint.players.find((player) => player.id === 'child');
  assert.ok(child);
  assert.ok(child.position.x <= -MATCH_RULES.playerRadius - 0.2);
  assert.ok(checkpoint.ghostHealth < MATCH_RULES.ghostMaxHealth);
});

test('client prediction stops at the same default furniture footprints', () => {
  const predicted = movePredictedPosition(
    { x: -3, z: -8.15 },
    { x: 1, z: 0 },
    4,
  );

  assert.ok(predicted.x < -1.7, `prediction crossed the dining table at x=${predicted.x}`);
  assert.equal(predicted.z, -8.15);
});
