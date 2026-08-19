import type { Vec2 } from './MatchEngine';

export interface AxisAlignedRect {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface OrientedRect {
  id: string;
  center: Vec2;
  halfWidth: number;
  halfDepth: number;
  yawRadians: number;
}

export function circleIntersectsAxisAlignedRect(
  position: Vec2,
  radius: number,
  rect: AxisAlignedRect,
): boolean {
  const closestX = Math.max(rect.minX, Math.min(position.x, rect.maxX));
  const closestZ = Math.max(rect.minZ, Math.min(position.z, rect.maxZ));
  return Math.hypot(position.x - closestX, position.z - closestZ) < radius;
}

export function circleIntersectsOrientedRect(
  position: Vec2,
  radius: number,
  rect: OrientedRect,
): boolean {
  const local = rotateIntoRect(position, rect);
  const closestX = Math.max(-rect.halfWidth, Math.min(local.x, rect.halfWidth));
  const closestZ = Math.max(-rect.halfDepth, Math.min(local.z, rect.halfDepth));
  return Math.hypot(local.x - closestX, local.z - closestZ) < radius;
}

export function orientedRectBounds(rect: OrientedRect): Omit<AxisAlignedRect, 'id'> {
  const cosine = Math.abs(Math.cos(rect.yawRadians));
  const sine = Math.abs(Math.sin(rect.yawRadians));
  const halfX = rect.halfWidth * cosine + rect.halfDepth * sine;
  const halfZ = rect.halfWidth * sine + rect.halfDepth * cosine;
  return {
    minX: rect.center.x - halfX,
    maxX: rect.center.x + halfX,
    minZ: rect.center.z - halfZ,
    maxZ: rect.center.z + halfZ,
  };
}

export function orientedRectsOverlap(left: OrientedRect, right: OrientedRect): boolean {
  const axes = [
    axisForYaw(left.yawRadians),
    depthAxisForYaw(left.yawRadians),
    axisForYaw(right.yawRadians),
    depthAxisForYaw(right.yawRadians),
  ];
  const offset = {
    x: right.center.x - left.center.x,
    z: right.center.z - left.center.z,
  };
  return axes.every((axis) => {
    const distance = Math.abs(offset.x * axis.x + offset.z * axis.z);
    return distance <= projectionRadius(left, axis) + projectionRadius(right, axis);
  });
}

export function segmentIntersectsOrientedRect(
  from: Vec2,
  to: Vec2,
  rect: OrientedRect,
  padding = 0,
): boolean {
  const localFrom = rotateIntoRect(from, rect);
  const localTo = rotateIntoRect(to, rect);
  const direction = {
    x: localTo.x - localFrom.x,
    z: localTo.z - localFrom.z,
  };
  let minimumTime = 0;
  let maximumTime = 1;
  for (const [start, delta, minimum, maximum] of [
    [localFrom.x, direction.x, -rect.halfWidth - padding, rect.halfWidth + padding],
    [localFrom.z, direction.z, -rect.halfDepth - padding, rect.halfDepth + padding],
  ]) {
    if (Math.abs(delta) < 1e-9) {
      if (start < minimum || start > maximum) return false;
      continue;
    }
    const first = (minimum - start) / delta;
    const second = (maximum - start) / delta;
    minimumTime = Math.max(minimumTime, Math.min(first, second));
    maximumTime = Math.min(maximumTime, Math.max(first, second));
    if (minimumTime > maximumTime) return false;
  }
  return true;
}

function rotateIntoRect(position: Vec2, rect: OrientedRect): Vec2 {
  const offsetX = position.x - rect.center.x;
  const offsetZ = position.z - rect.center.z;
  const cosine = Math.cos(rect.yawRadians);
  const sine = Math.sin(rect.yawRadians);
  return {
    x: offsetX * cosine - offsetZ * sine,
    z: offsetX * sine + offsetZ * cosine,
  };
}

function axisForYaw(yawRadians: number): Vec2 {
  return { x: Math.cos(yawRadians), z: -Math.sin(yawRadians) };
}

function depthAxisForYaw(yawRadians: number): Vec2 {
  return { x: Math.sin(yawRadians), z: Math.cos(yawRadians) };
}

function projectionRadius(rect: OrientedRect, axis: Vec2): number {
  const widthAxis = axisForYaw(rect.yawRadians);
  const depthAxis = depthAxisForYaw(rect.yawRadians);
  return rect.halfWidth * Math.abs(widthAxis.x * axis.x + widthAxis.z * axis.z)
    + rect.halfDepth * Math.abs(depthAxis.x * axis.x + depthAxis.z * axis.z);
}
