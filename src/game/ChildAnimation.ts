import * as THREE from 'three';
import type { CharacterAssetInstance, CharacterJoints } from '../assets/ImportedAssets';

type FlashlightArmJoints = Pick<
  CharacterJoints,
  'rightUpperArm' | 'rightLowerArm' | 'rightWrist' | 'rightHand'
>;

type JointRotation = readonly [x: number, y: number, z: number];
type FlashlightArmRig = Pick<
  CharacterAssetInstance,
  'root' | 'jointRestModelRotations' | 'jointRestRotations'
> & { joints: FlashlightArmJoints };

// KayKit Idle_A-relative rotations that aim the right-hand slot along the actor's +X axis.
const FLASHLIGHT_ARM_POSE = {
  upper: [1.74, -0.013, 0.71],
  lower: [1.31, -0.16, 0.055],
  wrist: [-0.61, -0.69, 0.15],
} as const satisfies Record<string, JointRotation>;

const ROTATION_AXIS = new THREE.Vector3();
const ROTATION_OFFSET = new THREE.Quaternion();
const MODEL_WORLD_ROTATION = new THREE.Quaternion();
const PARENT_WORLD_ROTATION = new THREE.Quaternion();
const TARGET_WORLD_ROTATION = new THREE.Quaternion();
const TARGET_ROTATION = new THREE.Quaternion();

/** Blends the animated right arm into a stable flashlight pose. */
export function stabilizeChildFlashlightArm(
  rig: FlashlightArmRig,
  progress: number,
): void {
  const blend = THREE.MathUtils.clamp(progress, 0, 1);
  if (blend <= 0) return;
  stabilizeUpperArm(rig, blend);
  stabilizeJoint(
    rig.joints.rightLowerArm,
    rig.jointRestRotations,
    FLASHLIGHT_ARM_POSE.lower,
    blend,
  );
  stabilizeJoint(
    rig.joints.rightWrist,
    rig.jointRestRotations,
    FLASHLIGHT_ARM_POSE.wrist,
    blend,
  );
  stabilizeJoint(rig.joints.rightHand, rig.jointRestRotations, [0, 0, 0], blend);
}

function stabilizeUpperArm(rig: FlashlightArmRig, blend: number): void {
  const joint = rig.joints.rightUpperArm;
  if (!joint?.parent) return;
  const restModelRotation = rig.jointRestModelRotations.get(joint);
  if (!restModelRotation) return;

  rig.root.getWorldQuaternion(MODEL_WORLD_ROTATION);
  joint.parent.getWorldQuaternion(PARENT_WORLD_ROTATION).invert();
  TARGET_WORLD_ROTATION.copy(MODEL_WORLD_ROTATION).multiply(restModelRotation);
  appendRotation(TARGET_WORLD_ROTATION, FLASHLIGHT_ARM_POSE.upper);
  TARGET_ROTATION.copy(PARENT_WORLD_ROTATION).multiply(TARGET_WORLD_ROTATION);
  joint.quaternion.slerp(TARGET_ROTATION, blend);
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
  appendRotation(TARGET_ROTATION, rotation);
  joint.quaternion.slerp(TARGET_ROTATION, blend);
}

function appendRotation(target: THREE.Quaternion, rotation: JointRotation): void {
  appendAxisRotation(target, 1, 0, 0, rotation[0]);
  appendAxisRotation(target, 0, 1, 0, rotation[1]);
  appendAxisRotation(target, 0, 0, 1, rotation[2]);
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
