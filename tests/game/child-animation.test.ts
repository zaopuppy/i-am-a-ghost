import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { stabilizeChildFlashlightArm } from '../../src/game/ChildAnimation';

const JOINT_NAMES = ['rightUpperArm', 'rightLowerArm', 'rightWrist'] as const;

test('fully raised flashlight arm ignores the running clip arm swing', () => {
  const first = createArmRig(0.72);
  const second = createArmRig(-0.64);

  stabilizeChildFlashlightArm(first.joints, first.restRotations, 1);
  stabilizeChildFlashlightArm(second.joints, second.restRotations, 1);

  for (const name of JOINT_NAMES) {
    assertQuaternionClose(first.joints[name].quaternion, second.joints[name].quaternion);
  }
});

test('lowered flashlight arm keeps the running clip arm swing', () => {
  const rig = createArmRig(0.72);
  const animatedRotations = JOINT_NAMES.map((name) => rig.joints[name].quaternion.clone());

  stabilizeChildFlashlightArm(rig.joints, rig.restRotations, 0);

  JOINT_NAMES.forEach((name, index) => {
    assertQuaternionClose(rig.joints[name].quaternion, animatedRotations[index]);
  });
});

test('raising the flashlight progressively removes the running clip arm swing', () => {
  const animated = createArmRig(0.72);
  const raised = createArmRig(0.72);
  const halfway = createArmRig(0.72);
  stabilizeChildFlashlightArm(raised.joints, raised.restRotations, 1);
  stabilizeChildFlashlightArm(halfway.joints, halfway.restRotations, 0.5);

  for (const name of JOINT_NAMES) {
    const totalChange = animated.joints[name].quaternion.angleTo(raised.joints[name].quaternion);
    const halfwayChange = animated.joints[name].quaternion.angleTo(halfway.joints[name].quaternion);
    assert.ok(halfwayChange > 0);
    assert.ok(halfwayChange < totalChange);
  }
});

function createArmRig(swingRadians: number) {
  const joints = {
    rightUpperArm: new THREE.Object3D(),
    rightLowerArm: new THREE.Object3D(),
    rightWrist: new THREE.Object3D(),
  };
  const restRotations = new Map<THREE.Object3D, THREE.Quaternion>();
  JOINT_NAMES.forEach((name, index) => {
    const joint = joints[name];
    joint.rotation.set(0.04 * index, -0.03 * index, 0.02 * index);
    restRotations.set(joint, joint.quaternion.clone());
    joint.rotateX(swingRadians * (1 - index * 0.2));
    joint.rotateZ(-swingRadians * 0.18);
  });
  return { joints, restRotations };
}

function assertQuaternionClose(actual: THREE.Quaternion, expected: THREE.Quaternion): void {
  assert.ok(actual.angleTo(expected) < 1e-7);
}
