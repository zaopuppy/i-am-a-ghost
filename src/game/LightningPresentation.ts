import {
  MATCH_RULES,
  type LightningDirection,
  type LightningPulse,
  type LightningStrike,
} from './MatchEngine';

const MAX_FRAME_DELTA_SECONDS = 0.05;
const DISCONTINUITY_SECONDS = 0.25;
const AUTHORITY_SNAP_TICKS = 6;
const ATTACK_RATIO = 0.12;
const RELEASE_START_RATIO = 0.62;
const PREFLASH_STRENGTHS = [0.72, 0.82, 0.76] as const;

export interface LightningPresentationState {
  strikeId: number | null;
  strikeStartTick: number | null;
  visualTick: number;
  lastElapsedSeconds: number | null;
  thunderHandled: boolean;
}

export interface LightningPresentationFrame {
  strikeId: number | null;
  strikeStartTick: number | null;
  direction: LightningDirection | null;
  intensity: number;
  pulseKind: LightningPulse['kind'] | null;
  visualTick: number;
  thunderDue: boolean;
  thunderDelayTicks: number | null;
  thunderVariant: LightningStrike['thunderVariant'] | null;
}

export function createLightningPresentationState(): LightningPresentationState {
  return {
    strikeId: null,
    strikeStartTick: null,
    visualTick: 0,
    lastElapsedSeconds: null,
    thunderHandled: false,
  };
}

export function advanceLightningPresentation(
  state: LightningPresentationState,
  strike: LightningStrike | null,
  authorityTick: number,
  elapsedSeconds: number,
): LightningPresentationFrame {
  const safeAuthorityTick = Number.isFinite(authorityTick) ? authorityTick : 0;
  const safeElapsedSeconds = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
  const previousElapsedSeconds = state.lastElapsedSeconds;
  const rawDeltaSeconds = previousElapsedSeconds === null
    ? 0
    : Math.max(0, safeElapsedSeconds - previousElapsedSeconds);
  state.lastElapsedSeconds = safeElapsedSeconds;

  if (!strike) {
    state.strikeId = null;
    state.strikeStartTick = null;
    state.visualTick = safeAuthorityTick;
    state.thunderHandled = false;
    return emptyFrame(safeAuthorityTick);
  }

  const newStrike = state.strikeId !== strike.id
    || state.strikeStartTick !== strike.startTick;
  let discontinuity = false;
  let previousVisualTick = state.visualTick;
  if (newStrike) {
    state.strikeId = strike.id;
    state.strikeStartTick = strike.startTick;
    state.visualTick = safeAuthorityTick;
    previousVisualTick = safeAuthorityTick;
    state.thunderHandled = safeAuthorityTick >= strike.thunderTick;
  } else {
    state.visualTick += Math.min(rawDeltaSeconds, MAX_FRAME_DELTA_SECONDS) * MATCH_RULES.tickRate;
    discontinuity = rawDeltaSeconds > DISCONTINUITY_SECONDS
      || Math.abs(state.visualTick - safeAuthorityTick) > AUTHORITY_SNAP_TICKS;
    if (discontinuity) state.visualTick = safeAuthorityTick;
  }

  let thunderDue = false;
  if (
    !newStrike
    && !discontinuity
    && !state.thunderHandled
    && previousVisualTick < strike.thunderTick
    && state.visualTick >= strike.thunderTick
  ) {
    thunderDue = true;
    state.thunderHandled = true;
  } else if (
    !state.thunderHandled
    && (discontinuity || state.visualTick >= strike.thunderTick)
  ) {
    state.thunderHandled = true;
  }

  const activePulseIndex = strike.pulses.findIndex((pulse) =>
    state.visualTick >= pulse.startTick
      && state.visualTick < pulse.startTick + pulse.durationTicks,
  );
  const activePulse = activePulseIndex >= 0 ? strike.pulses[activePulseIndex] : null;
  const mainPulse = strike.pulses.find((pulse) => pulse.kind === 'main');

  return {
    strikeId: strike.id,
    strikeStartTick: strike.startTick,
    direction: strike.direction,
    intensity: activePulse
      ? pulseIntensity(activePulse, activePulseIndex, state.visualTick)
      : 0,
    pulseKind: activePulse?.kind ?? null,
    visualTick: state.visualTick,
    thunderDue,
    thunderDelayTicks: mainPulse
      ? strike.thunderTick - (mainPulse.startTick + mainPulse.durationTicks)
      : null,
    thunderVariant: strike.thunderVariant,
  };
}

export function lightningSourceVector(direction: LightningDirection): Readonly<{ x: number; z: number }> {
  switch (direction) {
    case 'north': return { x: 0, z: 1 };
    case 'east': return { x: 1, z: 0 };
    case 'south': return { x: 0, z: -1 };
    case 'west': return { x: -1, z: 0 };
  }
}

function pulseIntensity(
  pulse: LightningPulse,
  pulseIndex: number,
  visualTick: number,
): number {
  const progress = clamp01((visualTick - pulse.startTick) / Math.max(1, pulse.durationTicks));
  const attack = smoothstep(clamp01(progress / ATTACK_RATIO));
  const release = 1 - smoothstep(clamp01(
    (progress - RELEASE_START_RATIO) / (1 - RELEASE_START_RATIO),
  ));
  const peak = pulse.kind === 'main'
    ? 1
    : PREFLASH_STRENGTHS[pulseIndex % PREFLASH_STRENGTHS.length];
  return peak * attack * release;
}

function emptyFrame(visualTick: number): LightningPresentationFrame {
  return {
    strikeId: null,
    strikeStartTick: null,
    direction: null,
    intensity: 0,
    pulseKind: null,
    visualTick,
    thunderDue: false,
    thunderDelayTicks: null,
    thunderVariant: null,
  };
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
