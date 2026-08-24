import assert from 'node:assert/strict';
import test from 'node:test';
import { joystickVectorFromDelta, movementFromPressed } from '../../src/core/GameInput';

test('WASD and arrow keys produce the same screen-space movement', () => {
  assert.deepEqual(movementFromPressed(new Set(['KeyW'])), { x: 0, z: -1 });
  assert.deepEqual(movementFromPressed(new Set(['ArrowUp'])), { x: 0, z: -1 });
  assert.deepEqual(movementFromPressed(new Set(['KeyS'])), { x: 0, z: 1 });
  assert.deepEqual(movementFromPressed(new Set(['ArrowDown'])), { x: 0, z: 1 });
  assert.deepEqual(movementFromPressed(new Set(['KeyA'])), { x: -1, z: 0 });
  assert.deepEqual(movementFromPressed(new Set(['ArrowLeft'])), { x: -1, z: 0 });
  assert.deepEqual(movementFromPressed(new Set(['KeyD'])), { x: 1, z: 0 });
  assert.deepEqual(movementFromPressed(new Set(['ArrowRight'])), { x: 1, z: 0 });
});

test('overlapping WASD and arrows do not stack, and opposites cancel', () => {
  assert.deepEqual(movementFromPressed(new Set(['KeyW', 'ArrowUp'])), { x: 0, z: -1 });
  assert.deepEqual(movementFromPressed(new Set(['KeyA', 'KeyD'])), { x: 0, z: 0 });
  assert.deepEqual(movementFromPressed(new Set(['KeyW', 'KeyD'])), { x: 1, z: -1 });
  assert.deepEqual(movementFromPressed(new Set()), { x: 0, z: 0 });
});

test('a floating joystick starts neutral and measures movement from the touch-down point', () => {
  assert.deepEqual(joystickVectorFromDelta(0, 0, 36), { x: 0, z: 0 });
  assert.deepEqual(joystickVectorFromDelta(18, 0, 36), { x: 0.5, z: 0 });
  assert.deepEqual(joystickVectorFromDelta(0, -18, 36), { x: 0, z: -0.5 });
  assert.deepEqual(joystickVectorFromDelta(3, 2, 36), { x: 0, z: 0 });
});

test('a floating joystick clamps diagonal movement to its visual radius', () => {
  const movement = joystickVectorFromDelta(100, 100, 36);

  assert.ok(Math.abs(Math.hypot(movement.x, movement.z) - 1) < 1e-9);
  assert.ok(movement.x > 0);
  assert.ok(movement.z > 0);
  assert.deepEqual(joystickVectorFromDelta(1, 1, 0), { x: 0, z: 0 });
});
