import type { Vec2 } from './MatchEngine';

export function advanceChildFacing(current: number, direction: Vec2 | null, deltaSeconds: number): number {
  if (!direction || Math.hypot(direction.x, direction.z) <= 0.001) return current;
  const delta = Math.atan2(direction.z, direction.x) - current;
  const shortest = Math.atan2(Math.sin(delta), Math.cos(delta));
  const result = current + shortest * (1 - Math.exp(-30 * Math.max(0, deltaSeconds)));
  return Math.atan2(Math.sin(result), Math.cos(result));
}

/** Speed uses torso/flashlight heading, never the cosmetic hip turn. */
export function childMovementMultiplier(movement: Vec2, facingRadians: number): number {
  const length = Math.hypot(movement.x, movement.z);
  if (length < 1e-8) return 1;
  const forward = (movement.x * Math.cos(facingRadians) + movement.z * Math.sin(facingRadians)) / length;
  return 0.95 + 0.05 * Math.max(-1, Math.min(1, forward));
}

/** Sideways reaches 45 degrees; forward and backward return to neutral. */
export function childHipOffset(movement: Vec2, facingRadians: number): number {
  const length = Math.hypot(movement.x, movement.z);
  if (length < 1e-8) return 0;
  return Math.PI / 4
    * (-movement.x * Math.sin(facingRadians) + movement.z * Math.cos(facingRadians)) / length;
}
