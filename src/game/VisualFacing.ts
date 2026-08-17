import type { Vec2 } from './MatchEngine';

const DEGREES_TO_RADIANS = Math.PI / 180;

export const AIM_DEADZONE_RADIUS = 0.42;
export const CHILD_HEAD_MAX_RADIANS = 45 * DEGREES_TO_RADIANS;
export const CHILD_CHEST_MAX_RADIANS = 20 * DEGREES_TO_RADIANS;
export const CHILD_IDLE_TURN_START_RADIANS = 65 * DEGREES_TO_RADIANS;
export const CHILD_IDLE_TURN_STOP_RADIANS = 25 * DEGREES_TO_RADIANS;
export const CHILD_IDLE_TURN_DELAY_SECONDS = 0.2;

const CHILD_MOVE_RESPONSE = 16;
const CHILD_IDLE_TURN_RESPONSE = 8;
const CHILD_LOOK_RESPONSE = 20;
const GHOST_AIM_RESPONSE = 14;

export interface VisualFacingState {
  bodyRadians: number;
  initialized: boolean;
  lookRadians: number;
  lookInitialized: boolean;
  idleTurnDelaySeconds: number;
  idleTurning: boolean;
}

export interface LookOffsets {
  chestRadians: number;
  headRadians: number;
}

export function createVisualFacingState(): VisualFacingState {
  return {
    bodyRadians: 0,
    initialized: false,
    lookRadians: 0,
    lookInitialized: false,
    idleTurnDelaySeconds: 0,
    idleTurning: false,
  };
}

export function normalizeRadians(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

export function shortestAngleDelta(fromRadians: number, toRadians: number): number {
  return normalizeRadians(toRadians - fromRadians);
}

export function dampAngle(
  currentRadians: number,
  targetRadians: number,
  response: number,
  deltaSeconds: number,
): number {
  const blend = 1 - Math.exp(-response * Math.max(0, deltaSeconds));
  return normalizeRadians(currentRadians + shortestAngleDelta(currentRadians, targetRadians) * blend);
}

export function movementFacing(
  previous: Vec2 | null,
  current: Vec2,
  minimumDistance = 0.004,
): number | null {
  if (!previous) return null;
  const offsetX = current.x - previous.x;
  const offsetZ = current.z - previous.z;
  if (Math.hypot(offsetX, offsetZ) < minimumDistance) return null;
  return Math.atan2(offsetZ, offsetX);
}

export function aimFacingWithDeadzone(
  origin: Vec2,
  target: Vec2,
  previousRadians: number,
  deadzoneRadius = AIM_DEADZONE_RADIUS,
): number {
  const offsetX = target.x - origin.x;
  const offsetZ = target.z - origin.z;
  if (Math.hypot(offsetX, offsetZ) < deadzoneRadius) return previousRadians;
  return Math.atan2(offsetZ, offsetX);
}

export function advanceChildBodyFacing(
  state: VisualFacingState,
  aimRadians: number,
  movementRadians: number | null,
  deltaSeconds: number,
): void {
  if (!state.initialized) {
    state.bodyRadians = movementRadians ?? aimRadians;
    state.initialized = true;
  }

  if (movementRadians !== null) {
    state.bodyRadians = dampAngle(
      state.bodyRadians,
      movementRadians,
      CHILD_MOVE_RESPONSE,
      deltaSeconds,
    );
    state.idleTurnDelaySeconds = 0;
    state.idleTurning = false;
    return;
  }

  const aimOffset = Math.abs(shortestAngleDelta(state.bodyRadians, aimRadians));
  if (state.idleTurning) {
    state.bodyRadians = dampAngle(
      state.bodyRadians,
      aimRadians,
      CHILD_IDLE_TURN_RESPONSE,
      deltaSeconds,
    );
    if (Math.abs(shortestAngleDelta(state.bodyRadians, aimRadians)) <= CHILD_IDLE_TURN_STOP_RADIANS) {
      state.idleTurning = false;
    }
    return;
  }

  if (aimOffset <= CHILD_IDLE_TURN_START_RADIANS) {
    state.idleTurnDelaySeconds = 0;
    return;
  }

  state.idleTurnDelaySeconds += Math.max(0, deltaSeconds);
  if (state.idleTurnDelaySeconds < CHILD_IDLE_TURN_DELAY_SECONDS) return;

  state.idleTurnDelaySeconds = 0;
  state.idleTurning = true;
  state.bodyRadians = dampAngle(
    state.bodyRadians,
    aimRadians,
    CHILD_IDLE_TURN_RESPONSE,
    deltaSeconds,
  );
}

export function advanceGhostBodyFacing(
  state: VisualFacingState,
  aimRadians: number,
  deltaSeconds: number,
): void {
  if (!state.initialized) {
    state.bodyRadians = aimRadians;
    state.initialized = true;
    return;
  }
  state.bodyRadians = dampAngle(state.bodyRadians, aimRadians, GHOST_AIM_RESPONSE, deltaSeconds);
}

export function advanceChildLookFacing(
  state: VisualFacingState,
  aimRadians: number,
  deltaSeconds: number,
): number {
  if (!state.lookInitialized) {
    state.lookRadians = aimRadians;
    state.lookInitialized = true;
  } else {
    state.lookRadians = dampAngle(state.lookRadians, aimRadians, CHILD_LOOK_RESPONSE, deltaSeconds);
  }
  return state.lookRadians;
}

export function calculateLookOffsets(bodyRadians: number, aimRadians: number): LookOffsets {
  const maximumLook = CHILD_HEAD_MAX_RADIANS + CHILD_CHEST_MAX_RADIANS;
  const totalLook = clamp(shortestAngleDelta(bodyRadians, aimRadians), -maximumLook, maximumLook);
  const chestRadians = clamp(
    totalLook * (CHILD_CHEST_MAX_RADIANS / maximumLook),
    -CHILD_CHEST_MAX_RADIANS,
    CHILD_CHEST_MAX_RADIANS,
  );
  return {
    chestRadians,
    headRadians: clamp(
      totalLook - chestRadians,
      -CHILD_HEAD_MAX_RADIANS,
      CHILD_HEAD_MAX_RADIANS,
    ),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
