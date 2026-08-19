import { MATCH_RULES, type Vec2 } from './MatchEngine';

export const CAPTURE_STRUGGLE_SECONDS = 2;
export const CAPTURE_HOLD_SECONDS = 1.5;
export const CAPTURE_CAMERA_FACING_RADIANS = Math.PI / 2;
export const CAPTURE_HOLD_DISTANCE = 0.7;
export const CAPTURE_HOLD_GRIP_PULL = 0.13;
export const CAPTURE_HEAD_PITCH_MIN = -0.22;
export const CAPTURE_HEAD_PITCH_MAX = 0.12;

export interface CapturePoseWeights {
  impact: number;
  struggle: number;
  hold: number;
  grip: number;
}

export function captureDurationSeconds(): number {
  return MATCH_RULES.captureAnimationTicks / MATCH_RULES.tickRate;
}

export function captureProgressFromTicks(ticksRemaining: number, durationTicks: number): number {
  return clamp01(1 - ticksRemaining / Math.max(1, durationTicks));
}

export function capturePoseWeights(progress: number): CapturePoseWeights {
  const holdStart = CAPTURE_STRUGGLE_SECONDS / Math.max(0.001, captureDurationSeconds());
  const impact = 1 - smoothstep(clamp01(progress / 0.12));
  const hold = smoothstep(clamp01((progress - holdStart) / Math.max(0.001, 1 - holdStart)));
  const seized = smoothstep(clamp01((progress - 0.07) / 0.13));
  const struggle = seized * (1 - hold);
  const grip = smoothstep(clamp01(progress / 0.18));
  return { impact, struggle, hold, grip };
}

export function captureHoldDistance(grip: number): number {
  return CAPTURE_HOLD_DISTANCE - grip * CAPTURE_HOLD_GRIP_PULL;
}

export function captureChildOffset(grip: number): Vec2 {
  const distance = captureHoldDistance(grip);
  return {
    x: Math.cos(CAPTURE_CAMERA_FACING_RADIANS) * distance,
    z: Math.sin(CAPTURE_CAMERA_FACING_RADIANS) * distance,
  };
}

export function clampCaptureHeadPitch(radians: number): number {
  return Math.min(CAPTURE_HEAD_PITCH_MAX, Math.max(CAPTURE_HEAD_PITCH_MIN, radians));
}

export function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
