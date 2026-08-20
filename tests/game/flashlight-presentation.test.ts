import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FLASHLIGHT_LOWER_SECONDS,
  FLASHLIGHT_RAISE_SECONDS,
  advanceFlashlightPresentation,
  createFlashlightPresentationState,
} from '../../src/game/FlashlightPresentation';

test('flashlight activation raises the hand over a short non-zero transition', () => {
  const state = createFlashlightPresentationState();
  const start = advanceFlashlightPresentation(state, true, 10);
  advanceFlashlightPresentation(state, true, 10 + 0.05);
  const midway = advanceFlashlightPresentation(state, true, 10 + FLASHLIGHT_RAISE_SECONDS / 2);
  advanceFlashlightPresentation(state, true, 10 + 0.14);
  const raised = advanceFlashlightPresentation(state, true, 10 + FLASHLIGHT_RAISE_SECONDS);

  assert.equal(start.poseProgress, 0);
  assert.equal(start.lightStrength, 0);
  assert.ok(midway.poseProgress > 0 && midway.poseProgress < 1);
  assert.equal(midway.lightStrength, 0);
  assert.equal(raised.poseProgress, 1);
  assert.equal(raised.lightStrength, 1);
});

test('flashlight release cuts the light immediately while the hand lowers', () => {
  const state = createFlashlightPresentationState();
  advanceFlashlightPresentation(state, true, 5);
  advanceFlashlightPresentation(state, true, 5.06);
  advanceFlashlightPresentation(state, true, 5.12);
  advanceFlashlightPresentation(state, true, 5 + FLASHLIGHT_RAISE_SECONDS);
  const release = advanceFlashlightPresentation(
    state,
    false,
    5 + FLASHLIGHT_RAISE_SECONDS + FLASHLIGHT_LOWER_SECONDS / 2,
  );
  const lowered = advanceFlashlightPresentation(
    state,
    false,
    5 + FLASHLIGHT_RAISE_SECONDS + FLASHLIGHT_LOWER_SECONDS,
  );

  assert.equal(release.lightStrength, 0);
  assert.ok(release.poseProgress > 0 && release.poseProgress < 1);
  assert.equal(lowered.poseProgress, 0);
});
