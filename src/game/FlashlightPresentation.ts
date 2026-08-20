export const FLASHLIGHT_RAISE_SECONDS = 0.18;
export const FLASHLIGHT_LOWER_SECONDS = 0.14;

const IGNITION_START_PROGRESS = 0.56;
const FULL_LIGHT_PROGRESS = 0.84;
const MAX_FRAME_DELTA_SECONDS = 0.08;

export interface FlashlightPresentationState {
  raiseProgress: number;
  lastUpdateSeconds: number | null;
}

export interface FlashlightPresentationFrame {
  poseProgress: number;
  lightStrength: number;
}

export function createFlashlightPresentationState(): FlashlightPresentationState {
  return {
    raiseProgress: 0,
    lastUpdateSeconds: null,
  };
}

export function advanceFlashlightPresentation(
  state: FlashlightPresentationState,
  requestedOn: boolean,
  elapsedSeconds: number,
): FlashlightPresentationFrame {
  const previousSeconds = state.lastUpdateSeconds;
  const deltaSeconds = previousSeconds === null
    ? 0
    : Math.min(
        MAX_FRAME_DELTA_SECONDS,
        Math.max(0, elapsedSeconds - previousSeconds),
      );
  state.lastUpdateSeconds = elapsedSeconds;

  const durationSeconds = requestedOn
    ? FLASHLIGHT_RAISE_SECONDS
    : FLASHLIGHT_LOWER_SECONDS;
  const direction = requestedOn ? 1 : -1;
  state.raiseProgress = clamp01(
    state.raiseProgress + direction * deltaSeconds / durationSeconds,
  );

  return {
    poseProgress: smoothstep(state.raiseProgress),
    lightStrength: requestedOn
      ? smoothstep(
          clamp01(
            (state.raiseProgress - IGNITION_START_PROGRESS)
              / (FULL_LIGHT_PROGRESS - IGNITION_START_PROGRESS),
          ),
        )
      : 0,
  };
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function clamp01(value: number): number {
  if (value <= 1e-9) return 0;
  if (value >= 1 - 1e-9) return 1;
  return value;
}
