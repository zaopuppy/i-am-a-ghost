import type { Vec2 } from './MatchEngine';

export interface WallBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const CONE_RAY_FACTORS = [-1, -0.5, 0, 0.5, 1] as const;
const DIRECTION_EPSILON = 1e-9;

export function clippedFlashlightLength(
  origin: Vec2,
  facingRadians: number,
  maximumLength: number,
  coneDegrees: number,
  walls: ReadonlyArray<WallBounds>,
): number {
  const safeMaximum = Math.max(0, maximumLength);
  const halfConeRadians = Math.max(0, coneDegrees) * Math.PI / 360;
  let clippedLength = safeMaximum;

  for (const factor of CONE_RAY_FACTORS) {
    const offset = halfConeRadians * factor;
    const axialScale = Math.cos(offset);
    const rayLimit = safeMaximum / Math.max(0.001, axialScale);
    const rayDistance = distanceToNearestWall(
      origin,
      facingRadians + offset,
      rayLimit,
      walls,
    );
    clippedLength = Math.min(clippedLength, rayDistance * axialScale);
  }

  return clippedLength;
}

function distanceToNearestWall(
  origin: Vec2,
  directionRadians: number,
  maximumDistance: number,
  walls: ReadonlyArray<WallBounds>,
): number {
  const directionX = Math.cos(directionRadians);
  const directionZ = Math.sin(directionRadians);
  let nearestDistance = maximumDistance;
  for (const wall of walls) {
    const distance = rayRectangleDistance(
      origin,
      directionX,
      directionZ,
      maximumDistance,
      wall,
    );
    if (distance !== null) nearestDistance = Math.min(nearestDistance, distance);
  }
  return nearestDistance;
}

function rayRectangleDistance(
  origin: Vec2,
  directionX: number,
  directionZ: number,
  maximumDistance: number,
  rectangle: WallBounds,
): number | null {
  let minimumDistance = 0;
  let maximumIntersectionDistance = maximumDistance;
  for (const [axisOrigin, axisDirection, minimum, maximum] of [
    [origin.x, directionX, rectangle.minX, rectangle.maxX],
    [origin.z, directionZ, rectangle.minZ, rectangle.maxZ],
  ] as const) {
    if (Math.abs(axisDirection) < DIRECTION_EPSILON) {
      if (axisOrigin < minimum || axisOrigin > maximum) return null;
      continue;
    }
    const first = (minimum - axisOrigin) / axisDirection;
    const second = (maximum - axisOrigin) / axisDirection;
    minimumDistance = Math.max(minimumDistance, Math.min(first, second));
    maximumIntersectionDistance = Math.min(maximumIntersectionDistance, Math.max(first, second));
    if (minimumDistance > maximumIntersectionDistance) return null;
  }
  return minimumDistance;
}
