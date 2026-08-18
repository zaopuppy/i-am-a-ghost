import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cameraAngles,
  cameraPresetFromPose,
  createRecommendedCameraPresets,
  formatCameraPreset,
  resolveCameraMode,
} from '../../src/core/CameraRig';

test('capture camera has priority over a developer preview', () => {
  assert.equal(resolveCameraMode('capture-closeup', 'follow'), 'capture-closeup');
  assert.equal(resolveCameraMode('follow', 'whole-house'), 'whole-house');
  assert.equal(resolveCameraMode('whole-house', null), 'whole-house');
});

test('recommended camera presets are independent mutable copies', () => {
  const first = createRecommendedCameraPresets();
  const second = createRecommendedCameraPresets();

  first.follow.position.x = 999;
  first['capture-closeup'].viewHeight = 999;

  assert.notEqual(second.follow.position.x, 999);
  assert.notEqual(second['capture-closeup'].viewHeight, 999);
});

test('camera pose serializes relative to its tracked subject', () => {
  const preset = cameraPresetFromPose(
    { x: 14.1254, y: 8, z: -2 },
    { x: 10, y: 1.25, z: -4 },
    { x: 10, y: 0, z: -5 },
    6.6666,
  );

  assert.deepEqual(preset, {
    position: { x: 4.125, y: 8, z: 3 },
    target: { x: 0, y: 1.25, z: 1 },
    viewHeight: 6.667,
  });
});

test('camera diagnostics report human-readable tilt and azimuth', () => {
  assert.deepEqual(
    cameraAngles({ x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: 0 }),
    { distance: 10, tiltDegrees: 0, azimuthDegrees: 0 },
  );
  assert.deepEqual(
    cameraAngles({ x: 10, y: 10, z: 0 }, { x: 0, y: 0, z: 0 }),
    { distance: 14.142, tiltDegrees: 45, azimuthDegrees: 90 },
  );
});

test('camera preset copy helpers produce TypeScript and JSON payloads', () => {
  const preset = createRecommendedCameraPresets()['capture-closeup'];
  const typescript = formatCameraPreset('capture-closeup', preset, 'typescript');
  const json = formatCameraPreset('capture-closeup', preset, 'json');

  assert.match(typescript, /'capture-closeup'/);
  assert.match(typescript, /satisfies CameraPreset/);
  assert.deepEqual(JSON.parse(json), { 'capture-closeup': preset });
});
