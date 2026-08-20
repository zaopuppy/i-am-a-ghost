import * as THREE from 'three';
import type { CharacterJoints } from '../assets/ImportedAssets';

type FlashlightArmJoints = Pick<
  CharacterJoints,
  'rightUpperArm' | 'rightLowerArm' | 'rightWrist' | 'rightHand'
>;

type JointRotation = readonly [x: number, y: number, z: number];

// KayKit Idle_A-relative rotations that aim the right-hand slot along the actor's +X axis.
const FLASHLIGHT_ARM_POSE = {
  upper: [1.74, -0.013, 0.71],
  lower: [1.31, -0.16, 0.055],
  wrist: [-0.61, -0.69, 0.15],
} as const satisfies Record<string, JointRotation>;

const ROTATION_AXIS = new THREE.Vector3();
const ROTATION_OFFSET = new THREE.Quaternion();
const TARGET_ROTATION = new THREE.Quaternion();

/** Blends the animated right arm into a stable flashlight pose. */
export function stabilizeChildFlashlightArm(
  joints: FlashlightArmJoints,
  jointRestRotations: ReadonlyMap<THREE.Object3D, THREE.Quaternion>,
  progress: number,
): void {
  const blend = THREE.MathUtils.clamp(progress, 0, 1);
  if (blend <= 0) return;
  stabilizeJoint(joints.rightUpperArm, jointRestRotations, FLASHLIGHT_ARM_POSE.upper, blend);
  stabilizeJoint(joints.rightLowerArm, jointRestRotations, FLASHLIGHT_ARM_POSE.lower, blend);
  stabilizeJoint(joints.rightWrist, jointRestRotations, FLASHLIGHT_ARM_POSE.wrist, blend);
  stabilizeJoint(joints.rightHand, jointRestRotations, [0, 0, 0], blend);
}

function stabilizeJoint(
  joint: THREE.Object3D | null,
  jointRestRotations: ReadonlyMap<THREE.Object3D, THREE.Quaternion>,
  rotation: JointRotation,
  blend: number,
): void {
  if (!joint) return;
  const restRotation = jointRestRotations.get(joint);
  if (!restRotation) return;

  TARGET_ROTATION.copy(restRotation);
  appendAxisRotation(TARGET_ROTATION, 1, 0, 0, rotation[0]);
  appendAxisRotation(TARGET_ROTATION, 0, 1, 0, rotation[1]);
  appendAxisRotation(TARGET_ROTATION, 0, 0, 1, rotation[2]);
  joint.quaternion.slerp(TARGET_ROTATION, blend);
}

function appendAxisRotation(
  target: THREE.Quaternion,
  x: number,
  y: number,
  z: number,
  radians: number,
): void {
  ROTATION_AXIS.set(x, y, z);
  ROTATION_OFFSET.setFromAxisAngle(ROTATION_AXIS, radians);
  target.multiply(ROTATION_OFFSET);
}
