import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createWebGlShadowBiasMatrix } from '../../src/core/Renderer';

test('WebGL volumetric shadow depth blocks samples behind a wall', () => {
  const camera = new THREE.PerspectiveCamera(36, 1, 0.08, 7.5);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const shadowMatrix = createWebGlShadowBiasMatrix()
    .multiply(camera.projectionMatrix)
    .multiply(camera.matrixWorldInverse);
  const wallPosition = new THREE.Vector3(0, 0, -3);
  const positionBehindWall = new THREE.Vector3(0, 0, -4);
  const wallDepth = projectShadowDepth(shadowMatrix, wallPosition);
  const receiverDepth = projectShadowDepth(shadowMatrix, positionBehindWall);
  const expectedWallDepth = wallPosition.clone().project(camera).z * 0.5 + 0.5;

  assert.ok(Math.abs(wallDepth - expectedWallDepth) < 1e-7);
  assert.ok(receiverDepth > wallDepth);
});

function projectShadowDepth(matrix: THREE.Matrix4, position: THREE.Vector3): number {
  const projected = new THREE.Vector4(position.x, position.y, position.z, 1).applyMatrix4(matrix);
  return projected.z / projected.w;
}
