import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ChildAim } from '../../src/core/ChildAim';
import { shortestAngleDelta } from '../../src/game/VisualFacing';
import { childMovementMultiplier } from '../../src/game/ChildMovement';

test('release turns into movement and smoothly restores speed; an idle release holds facing', () => {
  const aim = new ChildAim();
  aim.reset(Math.PI);
  const movement = { x: 1, z: 0 };
  let speed = 0.9;
  for (let tick = 0; tick < 6; tick += 1) {
    const facing = aim.update(movement, { x: -1, z: 0 }, false, 1 / 60);
    const next = childMovementMultiplier(movement, facing);
    assert.ok(next >= speed);
    speed = next;
  }
  assert.ok(speed > 0.999);
  const last = aim.radians;
  assert.equal(aim.update({ x: 0, z: 0 }, { x: -1, z: 0 }, false, 1), last);
  assert.equal(aim.update(movement, { x: 0, z: 0 }, true, 1), last);
  aim.update(movement, { x: -1, z: 0 }, true, 0.1);
  assert.ok(Math.abs(shortestAngleDelta(aim.radians, Math.PI)) < 0.16);
});

test('cursor projection aims at the world floor under a rotated perspective camera', () => {
  const aim = new ChildAim();
  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 100);
  camera.position.set(8, 14, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const bounds = { left: 40, top: 20, width: 1000, height: 500 };
  const target = new THREE.Vector3(2, 0, -3).project(camera);
  const mouse = { x: bounds.left + (target.x + 1) * 500, y: bounds.top + (1 - target.y) * 250 };
  const direction = aim.mouseDirection(mouse, bounds, camera, { x: 1, z: -1 });
  assert.ok(direction);
  assert.ok(Math.abs(direction.x - 1) < 1e-6);
  assert.ok(Math.abs(direction.z + 2) < 1e-6);
  assert.equal(aim.mouseDirection(mouse, bounds, camera, { x: 2, z: -3 }), null);
  assert.equal(aim.mouseDirection({ x: 0, y: 0 }, bounds, camera, { x: 0, z: 0 }), null);
});

test('aim follows the shortest turn, settles in about 100ms and holds on release or zero input', () => {
  const aim = new ChildAim();
  aim.reset(0);
  for (let index = 0; index < 6; index += 1) aim.advance({ x: 0, z: 1 }, 1 / 60);
  assert.ok(Math.abs(aim.radians - Math.PI / 2) < 0.08);
  const last = aim.radians;
  assert.equal(aim.advance(null, 1), last);
  assert.equal(aim.advance({ x: 0, z: 0 }, 1), last);
  aim.reset(Math.PI - 0.01);
  aim.advance({ x: -1, z: -0.01 }, 1 / 60);
  assert.ok(shortestAngleDelta(Math.PI - 0.01, aim.radians) > 0);
  assert.ok(Math.abs(shortestAngleDelta(Math.PI - 0.01, aim.radians)) < 0.02);
});
