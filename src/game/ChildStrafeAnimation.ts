import * as THREE from 'three';
import type { CharacterAssetInstance } from '../assets/ImportedAssets';
import type { Vec2 } from './MatchEngine';
import { childHipOffset } from './ChildMovement';

const STRIDE_DISTANCE = 0.6;
const FOOT_LIFT = 0.09;
const UP = new THREE.Vector3(0, 1, 0);

interface Leg {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  foot: THREE.Object3D;
  restFoot: THREE.Vector3;
  restRotation: THREE.Quaternion;
}

/** Side-step foot targets: planted feet travel opposite the body, then lift and recover. */
export function strafeFootTarget(phase: number): { travel: number; lift: number } {
  const cycle = ((phase % 1) + 1) % 1;
  if (cycle < 0.5) return { travel: STRIDE_DISTANCE * (0.25 - cycle), lift: 0 };
  const swing = (cycle - 0.5) * 2;
  const eased = swing * swing * (3 - 2 * swing);
  return {
    travel: STRIDE_DISTANCE * (eased * 0.5 - 0.25),
    lift: Math.sin(swing * Math.PI) * FOOT_LIFT,
  };
}

/** A short lateral shuffle layered over the existing clip, with two-bone leg IK. */
export class ChildStrafeAnimation {
  private readonly legs: Leg[] = [];
  private readonly hips: THREE.Object3D | null;
  private readonly hipsPosition: THREE.Vector3;
  private readonly hipsRotation: THREE.Quaternion;
  private readonly baseHipsRotation = new THREE.Quaternion();
  private readonly baseHipsPosition = new THREE.Vector3();
  private hipsPosed = false;
  private phase = 0;
  private weight = 0;
  private hipOffset = 0;
  private readonly hipTurn = new THREE.Quaternion();
  private readonly chestWorldRotation = new THREE.Quaternion();
  private readonly hipCenter = new THREE.Vector3();
  private readonly direction = new THREE.Vector3(0, 0, 1);
  private readonly target = new THREE.Vector3();
  private readonly hip = new THREE.Vector3();
  private readonly knee = new THREE.Vector3();
  private readonly ankle = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly bend = new THREE.Vector3();
  private readonly desiredKnee = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly parentRotation = new THREE.Quaternion();
  private readonly rootRotation = new THREE.Quaternion();
  private readonly savedUpper = new THREE.Quaternion();
  private readonly savedLower = new THREE.Quaternion();
  private readonly savedFoot = new THREE.Quaternion();

  constructor(private readonly rig: CharacterAssetInstance) {
    rig.root.updateMatrixWorld(true);
    this.hips = rig.joints.leftUpperLeg?.parent ?? null;
    this.hipsPosition = this.hips?.position.clone() ?? new THREE.Vector3();
    this.hipsRotation = this.hips?.quaternion.clone() ?? new THREE.Quaternion();
    if (this.hips) rig.root.worldToLocal(this.hips.getWorldPosition(this.hipCenter));
    rig.root.getWorldQuaternion(this.rootRotation).invert();
    for (const [upper, lower] of [
      [rig.joints.leftUpperLeg, rig.joints.leftLowerLeg],
      [rig.joints.rightUpperLeg, rig.joints.rightLowerLeg],
    ]) {
      const foot = lower?.children.find((child) => child.name.toLowerCase().startsWith('foot'));
      if (!upper || !lower || !foot) continue;
      this.legs.push({
        upper, lower, foot,
        restFoot: rig.root.worldToLocal(foot.getWorldPosition(new THREE.Vector3())),
        restRotation: this.rootRotation.clone().multiply(foot.getWorldQuaternion(new THREE.Quaternion())),
      });
    }
  }

  restoreBasePose(): void {
    // Some clips omit hip tracks, and capture freezes the mixer. Never let a
    // previous frame's procedural turn become the following frame's base pose.
    if (!this.hips || !this.hipsPosed) return;
    this.hips.quaternion.copy(this.baseHipsRotation);
    this.hips.position.copy(this.baseHipsPosition);
    this.hipsPosed = false;
  }

  update(displacement: Vec2, facingRadians: number, deltaSeconds: number, enabled: boolean): void {
    const distance = Math.hypot(displacement.x, displacement.z);
    const localX = displacement.x * Math.cos(facingRadians) + displacement.z * Math.sin(facingRadians);
    const localZ = -displacement.x * Math.sin(facingRadians) + displacement.z * Math.cos(facingRadians);
    const moving = enabled && distance > 0.0001 && deltaSeconds > 0;
    const sideways = moving ? Math.abs(localZ) / distance : 0;
    const targetWeight = THREE.MathUtils.smoothstep(sideways, 0.45, 0.85);
    this.weight = THREE.MathUtils.lerp(this.weight, targetWeight, 1 - Math.exp(-24 * deltaSeconds));
    this.hipOffset = THREE.MathUtils.lerp(
      this.hipOffset,
      moving ? childHipOffset(displacement, facingRadians) : 0,
      1 - Math.exp(-24 * deltaSeconds),
    );
    if (!enabled) {
      this.weight = 0;
      this.phase = 0;
      this.hipOffset = 0;
      return;
    }
    if (moving) {
      this.phase = (this.phase + Math.min(distance, 0.15) / STRIDE_DISTANCE) % 1;
      // Blend direction changes so reversing a strafe does not teleport a planted foot.
      this.to.set(localX / distance, 0, localZ / distance);
      this.direction.lerp(this.to, 1 - Math.exp(-24 * deltaSeconds));
    }
    if ((this.weight < 0.001 && Math.abs(this.hipOffset) < 0.001) || this.legs.length !== 2) return;
    this.rig.root.updateMatrixWorld(true);
    this.rig.root.getWorldQuaternion(this.rootRotation);
    this.hipTurn.setFromAxisAngle(UP, -this.hipOffset);
    const chest = this.rig.joints.chest;
    chest?.getWorldQuaternion(this.chestWorldRotation);
    if (this.hips) {
      this.baseHipsRotation.copy(this.hips.quaternion);
      this.baseHipsPosition.copy(this.hips.position);
      this.hipsPosed = true;
      // Remove the forward-running hip bounce/twist while side-stepping.
      this.hips.position.lerp(this.hipsPosition, this.weight);
      this.hips.quaternion.slerp(this.hipsRotation, this.weight);
      // Turn the pelvis in torso space, compensating the chest so the light stays on aim.
      this.hips.getWorldQuaternion(this.rotation);
      this.parentRotation.copy(this.rootRotation).invert();
      this.rotation.premultiply(this.parentRotation).premultiply(this.hipTurn).premultiply(this.rootRotation);
      this.hips.parent!.getWorldQuaternion(this.parentRotation).invert();
      this.hips.quaternion.copy(this.parentRotation).multiply(this.rotation);
      this.hips.updateWorldMatrix(false, true);
      if (chest?.parent) {
        chest.parent.getWorldQuaternion(this.parentRotation).invert();
        chest.quaternion.copy(this.parentRotation).multiply(this.chestWorldRotation);
      }
    }
    this.rig.root.updateMatrixWorld(true);
    this.rig.root.getWorldQuaternion(this.rootRotation);
    for (const [index, leg] of this.legs.entries()) {
      const step = strafeFootTarget(this.phase + index * 0.5);
      this.target.copy(leg.restFoot).sub(this.hipCenter).applyQuaternion(this.hipTurn).add(this.hipCenter);
      this.target.addScaledVector(this.direction, step.travel);
      this.target.y += step.lift;
      this.rig.root.localToWorld(this.target);
      this.solveLeg(leg);
    }
  }

  private solveLeg(leg: Leg): void {
    this.savedUpper.copy(leg.upper.quaternion);
    this.savedLower.copy(leg.lower.quaternion);
    this.savedFoot.copy(leg.foot.quaternion);
    leg.upper.getWorldPosition(this.hip);
    leg.lower.getWorldPosition(this.knee);
    leg.foot.getWorldPosition(this.ankle);
    const upperLength = this.hip.distanceTo(this.knee);
    const lowerLength = this.knee.distanceTo(this.ankle);
    this.axis.subVectors(this.target, this.hip);
    const reach = THREE.MathUtils.clamp(this.axis.length(), 0.001, (upperLength + lowerLength) * 0.999);
    this.axis.normalize();
    const along = (upperLength ** 2 - lowerLength ** 2 + reach ** 2) / (2 * reach);
    const height = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2));
    // Knees keep bending forward even as the feet move sideways.
    this.bend.set(1, 0, 0).applyQuaternion(this.hipTurn).applyQuaternion(this.rootRotation);
    this.bend.addScaledVector(this.axis, -this.bend.dot(this.axis));
    if (this.bend.lengthSq() < 1e-6) this.bend.copy(UP).cross(this.axis);
    this.bend.normalize();
    this.desiredKnee.copy(this.hip).addScaledVector(this.axis, along).addScaledVector(this.bend, height);
    this.pointJoint(leg.upper, this.hip, this.knee, this.desiredKnee);
    leg.lower.getWorldPosition(this.knee);
    leg.foot.getWorldPosition(this.ankle);
    this.pointJoint(leg.lower, this.knee, this.ankle, this.target);
    // Preserve the shoe's resting orientation rather than twisting it with the thigh.
    leg.foot.parent!.getWorldQuaternion(this.parentRotation).invert();
    leg.foot.quaternion.copy(this.parentRotation).multiply(this.rootRotation).multiply(this.hipTurn).multiply(leg.restRotation);
    leg.upper.quaternion.slerp(this.savedUpper, 1 - this.weight);
    leg.lower.quaternion.slerp(this.savedLower, 1 - this.weight);
    leg.foot.quaternion.slerp(this.savedFoot, 1 - this.weight);
    leg.upper.updateWorldMatrix(false, true);
  }

  private pointJoint(joint: THREE.Object3D, origin: THREE.Vector3, current: THREE.Vector3, target: THREE.Vector3): void {
    this.from.subVectors(current, origin).normalize();
    this.to.subVectors(target, origin).normalize();
    this.rotation.setFromUnitVectors(this.from, this.to);
    joint.getWorldQuaternion(this.parentRotation);
    this.rotation.multiply(this.parentRotation);
    joint.parent!.getWorldQuaternion(this.parentRotation).invert();
    joint.quaternion.copy(this.parentRotation).multiply(this.rotation);
    joint.updateWorldMatrix(false, true);
  }
}
