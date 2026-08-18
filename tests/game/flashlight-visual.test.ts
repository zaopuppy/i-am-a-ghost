import assert from 'node:assert/strict';
import test from 'node:test';
import { clippedFlashlightLength } from '../../src/game/FlashlightVisual';

test('flashlight visual stops at the first wall in front of it', () => {
  const length = clippedFlashlightLength(
    { x: 0, z: 0 },
    0,
    8,
    20,
    [{ minX: 2, maxX: 2.2, minZ: -1, maxZ: 1 }],
  );

  assert.ok(Math.abs(length - 2) < 1e-6);
});

test('a wall behind the flashlight does not shorten its beam', () => {
  const length = clippedFlashlightLength(
    { x: 0, z: 0 },
    0,
    8,
    20,
    [{ minX: -2.2, maxX: -2, minZ: -1, maxZ: 1 }],
  );

  assert.equal(length, 8);
});

test('a wall intersecting the cone edge clips the whole visual before penetration', () => {
  const length = clippedFlashlightLength(
    { x: 0, z: 0 },
    0,
    8,
    20,
    [{ minX: 3, maxX: 3.2, minZ: 0.4, maxZ: 1.4 }],
  );

  assert.ok(length >= 2.99 && length <= 3.01);
});
