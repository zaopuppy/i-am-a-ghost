import assert from 'node:assert/strict';
import test from 'node:test';
import { movementFromPressed } from '../../src/core/GameInput';

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
