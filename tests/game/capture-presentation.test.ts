import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAPTURE_CAMERA_FACING_RADIANS,
  CAPTURE_HEAD_PITCH_MAX,
  captureChildOffset,
  captureDurationSeconds,
  capturePoseWeights,
  clampCaptureHeadPitch,
} from '../../src/game/CapturePresentation';
import { ghostFadeOpacity } from '../../src/game/GhostPresentation';
import { MATCH_RULES } from '../../src/game/MatchEngine';

test('capture animation lasts three and a half seconds with a late hold', () => {
  assert.equal(MATCH_RULES.captureAnimationTicks, 210);
  assert.equal(captureDurationSeconds(), 3.5);

  const impact = capturePoseWeights(0.03);
  assert.ok(impact.impact > 0.7);
  assert.ok(impact.hold < 0.01);
  assert.ok(impact.struggle < 0.01);

  const struggle = capturePoseWeights(0.45);
  assert.ok(struggle.struggle > 0.6);
  assert.equal(struggle.hold, 0);

  const hold = capturePoseWeights(0.95);
  assert.ok(hold.hold > 0.95);
  assert.ok(hold.struggle < 0.05);
  assert.ok(hold.impact < 0.01);
});

test('capture tableau puts the child toward the south-facing camera', () => {
  const offset = captureChildOffset(1);
  assert.ok(offset.z > 0.5);
  assert.ok(Math.abs(offset.x) < 0.001);
  assert.equal(CAPTURE_CAMERA_FACING_RADIANS, Math.PI / 2);
});

test('capture head pitch cannot snap past the hold clamp', () => {
  assert.equal(clampCaptureHeadPitch(0.4), CAPTURE_HEAD_PITCH_MAX);
  assert.equal(clampCaptureHeadPitch(-0.4), -0.22);
  assert.equal(clampCaptureHeadPitch(0.04), 0.04);
});

test('a hidden ghost fades out in a quarter second and then disappears', () => {
  assert.equal(ghostFadeOpacity(0), 1);
  assert.ok((ghostFadeOpacity(0.125) ?? -1) > 0.4);
  assert.ok((ghostFadeOpacity(0.125) ?? 2) < 0.6);
  assert.equal(ghostFadeOpacity(0.25), null);
  assert.equal(ghostFadeOpacity(1), null);
});
