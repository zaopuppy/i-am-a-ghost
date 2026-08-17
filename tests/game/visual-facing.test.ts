import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceChildBodyFacing,
  advanceChildLookFacing,
  advanceGhostBodyFacing,
  aimFacingWithDeadzone,
  calculateLookOffsets,
  CHILD_CHEST_MAX_RADIANS,
  CHILD_HEAD_MAX_RADIANS,
  CHILD_IDLE_TURN_DELAY_SECONDS,
  createVisualFacingState,
  movementFacing,
  shortestAngleDelta,
} from '../../src/game/VisualFacing';

const DEG = Math.PI / 180;

function assertNear(actual: number, expected: number, epsilon = 1e-6): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test('shortest angle delta crosses the wrap boundary instead of turning the long way', () => {
  assertNear(shortestAngleDelta(179 * DEG, -179 * DEG), 2 * DEG);
  assertNear(shortestAngleDelta(-179 * DEG, 179 * DEG), -2 * DEG);
});

test('aim deadzone keeps the last meaningful direction', () => {
  const previous = 70 * DEG;
  assert.equal(
    aimFacingWithDeadzone({ x: 2, z: 3 }, { x: 2.1, z: 3.1 }, previous),
    previous,
  );
  assertNear(
    aimFacingWithDeadzone({ x: 2, z: 3 }, { x: 2, z: 5 }, previous),
    Math.PI / 2,
  );
});

test('movement heading is independent from aim and ignores positional noise', () => {
  assert.equal(movementFacing({ x: 0, z: 0 }, { x: 0.001, z: 0 }), null);
  assertNear(movementFacing({ x: 1, z: 1 }, { x: 1, z: 2 }) ?? 0, Math.PI / 2);
});

test('moving child follows movement while an idle child waits before turning to aim', () => {
  const state = createVisualFacingState();
  advanceChildBodyFacing(state, Math.PI, 0, 0);
  assertNear(state.bodyRadians, 0);

  advanceChildBodyFacing(state, Math.PI, null, CHILD_IDLE_TURN_DELAY_SECONDS * 0.5);
  assert.equal(state.idleTurning, false);
  assertNear(state.bodyRadians, 0);

  advanceChildBodyFacing(state, Math.PI, null, CHILD_IDLE_TURN_DELAY_SECONDS * 0.5);
  assert.equal(state.idleTurning, true);
  assert.ok(Math.abs(state.bodyRadians) > 0);
});

test('head and chest share look motion and clamp at the combined anatomical limit', () => {
  const offsets = calculateLookOffsets(0, Math.PI);
  assertNear(Math.abs(offsets.chestRadians), CHILD_CHEST_MAX_RADIANS);
  assertNear(Math.abs(offsets.headRadians), CHILD_HEAD_MAX_RADIANS);
  assertNear(
    Math.abs(offsets.chestRadians + offsets.headRadians),
    CHILD_CHEST_MAX_RADIANS + CHILD_HEAD_MAX_RADIANS,
  );
});

test('ghost facing smoothing also takes the short path across angle wrap', () => {
  const state = createVisualFacingState();
  advanceGhostBodyFacing(state, 179 * DEG, 0);
  advanceGhostBodyFacing(state, -179 * DEG, 1 / 60);
  assert.ok(shortestAngleDelta(179 * DEG, state.bodyRadians) > 0);
  assert.ok(Math.abs(shortestAngleDelta(state.bodyRadians, -179 * DEG)) < 2 * DEG);
});

test('child look smooths network updates without changing the target aim', () => {
  const state = createVisualFacingState();
  assertNear(advanceChildLookFacing(state, 0, 0), 0);
  const visualLook = advanceChildLookFacing(state, Math.PI / 2, 1 / 60);
  assert.ok(visualLook > 0);
  assert.ok(visualLook < Math.PI / 2);
});
