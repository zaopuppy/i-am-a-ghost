import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { stabilizeChildFlashlightArm } from '../../src/game/ChildAnimation';

const JOINT_NAMES = ['rightUpperArm', 'rightLowerArm', 'rightWrist', 'rightHand'] as const;

test('fully raised flashlight arm ignores the running clip arm swing', () => {
  const first = createArmRig(0.72);
  const second = createArmRig(-0.64);

  stabilizeChildFlashlightArm(first, 1);
  stabilizeChildFlashlightArm(second, 1);

  for (const name of JOINT_NAMES) {
    assertQuaternionClose(worldRotation(first.joints[name]), worldRotation(second.joints[name]));
  }
});

test('lowered flashlight arm keeps the running clip arm swing', () => {
  const rig = createArmRig(0.72);
  const animatedRotations = JOINT_NAMES.map((name) => rig.joints[name].quaternion.clone());

  stabilizeChildFlashlightArm(rig, 0);

  JOINT_NAMES.forEach((name, index) => {
    assertQuaternionClose(rig.joints[name].quaternion, animatedRotations[index]);
  });
});

test('raising the flashlight progressively removes the running clip arm swing', () => {
  const animated = createArmRig(0.72);
  const raised = createArmRig(0.72);
  const halfway = createArmRig(0.72);
  stabilizeChildFlashlightArm(raised, 1);
  stabilizeChildFlashlightArm(halfway, 0.5);

  for (const name of JOINT_NAMES) {
    const totalChange = animated.joints[name].quaternion.angleTo(raised.joints[name].quaternion);
    const halfwayChange = animated.joints[name].quaternion.angleTo(halfway.joints[name].quaternion);
    assert.ok(halfwayChange > 0);
    assert.ok(halfwayChange < totalChange);
  }
});

function createArmRig(swingRadians: number) {
  const root = new THREE.Group();
  const chest = new THREE.Object3D();
  const joints = {
    rightUpperArm: new THREE.Object3D(),
    rightLowerArm: new THREE.Object3D(),
    rightWrist: new THREE.Object3D(),
    rightHand: new THREE.Object3D(),
  };
  root.add(chest);
  chest.add(joints.rightUpperArm);
  joints.rightUpperArm.add(joints.rightLowerArm);
  joints.rightLowerArm.add(joints.rightWrist);
  joints.rightWrist.add(joints.rightHand);
  const restRotations = new Map<THREE.Object3D, THREE.Quaternion>();
  JOINT_NAMES.forEach((name, index) => {
    const joint = joints[name];
    joint.rotation.set(0.04 * index, -0.03 * index, 0.02 * index);
    restRotations.set(joint, joint.quaternion.clone());
  });
  root.updateMatrixWorld(true);
  const jointRestModelRotations = new Map<THREE.Object3D, THREE.Quaternion>();
  JOINT_NAMES.forEach((name) => {
    const joint = joints[name];
    jointRestModelRotations.set(joint, worldRotation(joint));
  });
  chest.rotateY(swingRadians * 0.24);
  JOINT_NAMES.forEach((name, index) => {
    const joint = joints[name];
    joint.rotateX(swingRadians * (1 - index * 0.2));
    joint.rotateZ(-swingRadians * 0.18);
  });
  return {
    root,
    joints,
    jointRestModelRotations,
    jointRestRotations: restRotations,
  };
}

function worldRotation(object: THREE.Object3D): THREE.Quaternion {
  return object.getWorldQuaternion(new THREE.Quaternion());
}

function assertQuaternionClose(actual: THREE.Quaternion, expected: THREE.Quaternion): void {
  assert.ok(actual.angleTo(expected) < 1e-7);
}
