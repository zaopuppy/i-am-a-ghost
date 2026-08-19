import {
  circleIntersectsAxisAlignedRect,
  circleIntersectsOrientedRect,
  segmentIntersectsOrientedRect,
} from './CollisionGeometry';
import type { MatchMap, Vec2 } from './MatchEngine';

export function mapPositionIsOpen(map: MatchMap, position: Vec2, radius: number): boolean {
  if (
    position.x - radius < map.bounds.minX
    || position.x + radius > map.bounds.maxX
    || position.z - radius < map.bounds.minZ
    || position.z + radius > map.bounds.maxZ
  ) return false;
  if (map.walls.some((wall) => circleIntersectsAxisAlignedRect(position, radius, wall))) {
    return false;
  }
  return !(map.movementObstacles ?? []).some((obstacle) =>
    circleIntersectsOrientedRect(position, radius, obstacle),
  );
}

export function mapSegmentIsOpen(
  map: MatchMap,
  from: Vec2,
  to: Vec2,
  radius: number,
): boolean {
  for (const wall of map.walls) {
    const obstacle = {
      id: wall.id,
      center: {
        x: (wall.minX + wall.maxX) / 2,
        z: (wall.minZ + wall.maxZ) / 2,
      },
      halfWidth: (wall.maxX - wall.minX) / 2,
      halfDepth: (wall.maxZ - wall.minZ) / 2,
      yawRadians: 0,
    };
    if (segmentIntersectsOrientedRect(from, to, obstacle, radius)) return false;
  }
  return !(map.movementObstacles ?? []).some((obstacle) =>
    segmentIntersectsOrientedRect(from, to, obstacle, radius),
  );
}
