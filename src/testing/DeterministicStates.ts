import {
  MATCH_RULES,
  type LightningDirection,
  type LightningStrike,
} from '../game/MatchEngine';
import type {
  GhostViewerFrame,
  ViewerFrame,
  VisibleChild,
  VisibleDoll,
  VisibleGhost,
} from '../game/ViewerFrame';

export const DETERMINISTIC_STATE_NAMES = [
  'child-hidden',
  'child-playing',
  'flashlight-off-range',
  'flashlight-wall',
  'ghost-playing',
  'low-battery',
  'capture',
  'protection',
  'child-win',
  'ghost-win',
  'lightning-north-main',
  'lightning-east-main',
  'lightning-south-main',
  'lightning-west-main',
] as const;

export type DeterministicStateName = (typeof DETERMINISTIC_STATE_NAMES)[number];

const CHILDREN: readonly VisibleChild[] = [
  child('child-1', 0, -10.7, -6.7, 0, 'solid', true),
  child('child-2', 1, 9.2, -6.4, Math.PI * 0.8, 'off', false),
  child('child-3', 2, -9.4, 6.5, -0.2, 'slow', false),
  child('child-4', 3, 10.8, 6.1, Math.PI, 'off', false),
];

const DOLLS: readonly VisibleDoll[] = [
  { dollId: 'doll-2', slot: 1, position: { x: 9.2, z: -6.4 }, headlamp: 'off' },
  { dollId: 'doll-3', slot: 2, position: { x: -9.4, z: 6.5 }, headlamp: 'slow' },
  { dollId: 'doll-4', slot: 3, position: { x: 10.8, z: 6.1 }, headlamp: 'off' },
];

const GHOST: VisibleGhost = {
  position: { x: -9.55, z: -6.7 },
  facingRadians: Math.PI,
  burning: false,
  burnTicksRemaining: 0,
};

export function isDeterministicStateName(value: string | null): value is DeterministicStateName {
  return DETERMINISTIC_STATE_NAMES.some((name) => name === value);
}

export function createDeterministicViewerFrame(
  state: DeterministicStateName,
  seed = 0,
): ViewerFrame {
  const tick = 4200 + Math.abs(Math.trunc(seed)) % 60;
  const lightningDirection = lightningDirectionForState(state);
  const common = {
    tick,
    remainingTicks: 13_800,
    captureCount: 1,
    ghostHealth: 62,
    lightning: lightningDirection ? lightningAtMainPeak(lightningDirection, tick) : null,
    winner: null,
    capture: null,
  } as const;

  if (state === 'ghost-playing' || state === 'ghost-win') {
    const ended = state === 'ghost-win';
    const batteries = [{ batteryId: 'battery-1', position: { x: 2.2, z: 0 } }];
    const frame: GhostViewerFrame = {
      ...common,
      phase: ended ? 'ended' : 'playing',
      winner: ended ? 'ghost' : null,
      remainingTicks: ended ? 9_360 : common.remainingTicks,
      captureCount: ended ? 3 : common.captureCount,
      viewerRole: 'ghost',
      viewerPlayerId: 'ghost',
      ghost: { ...GHOST },
      children: cloneChildren(CHILDREN.slice(0, 1)),
      dolls: cloneDolls(DOLLS),
      batteries,
      battery: batteries[0],
    };
    return frame;
  }

  const ended = state === 'child-win';
  const hidden = state === 'child-hidden'
    || state === 'flashlight-off-range'
    || state === 'flashlight-wall'
    || state === 'protection';
  const phase = state === 'capture'
    ? 'capture-animation'
    : state === 'protection'
      ? 'protection'
      : ended
        ? 'ended'
        : 'playing';
  const children = (state === 'child-hidden'
    ? cloneChildren(CHILDREN.slice(0, 2)).map((visibleChild) => ({ ...visibleChild, flashlightOn: false }))
    : cloneChildren(CHILDREN))
    .map((visibleChild) => {
      if (state === 'flashlight-off-range') return { ...visibleChild, headlamp: 'off' as const };
      if (state === 'flashlight-wall') {
        return visibleChild.playerId === 'child-1'
          ? {
              ...visibleChild,
              position: { x: -8, z: -5.62 },
              facingRadians: 0,
              headlamp: 'off' as const,
              flashlightOn: true,
            }
          : { ...visibleChild, headlamp: 'off' as const, flashlightOn: false };
      }
      if (state === 'low-battery' && visibleChild.playerId === 'child-1') {
        return { ...visibleChild, batteryCharge: 0.08 };
      }
      return visibleChild;
    });
  const batteries = state === 'low-battery'
    ? [
        { batteryId: 'battery-1', position: { x: 5.8, z: 4.8 } },
        { batteryId: 'battery-2', position: { x: -5.6, z: 4.4 } },
      ]
    : [];

  const ghost = lightningDirection
    ? { ...GHOST, position: lightningGhostPosition(lightningDirection) }
    : { ...GHOST, position: { ...GHOST.position } };

  return {
    ...common,
    phase,
    winner: ended ? 'children' : null,
    remainingTicks: ended ? 11_520 : common.remainingTicks,
    ghostHealth: ended ? 0 : common.ghostHealth,
    capture: state === 'capture'
      ? {
          childPlayerId: 'child-1',
          ticksRemaining: Math.round(MATCH_RULES.captureAnimationTicks * 0.58),
          durationTicks: MATCH_RULES.captureAnimationTicks,
        }
      : null,
    viewerRole: 'child',
    viewerPlayerId: 'child-1',
    ownBattery: state === 'low-battery' ? 0.08 : 0.58,
    children,
    dolls: hidden && children.length === 2 ? cloneDolls(DOLLS.slice(1)) : [],
    batteries,
    ...(!hidden ? { ghost } : {}),
    ...(batteries[0] ? { battery: batteries[0] } : {}),
  };
}

function lightningDirectionForState(state: DeterministicStateName): LightningDirection | null {
  switch (state) {
    case 'lightning-north-main': return 'north';
    case 'lightning-east-main': return 'east';
    case 'lightning-south-main': return 'south';
    case 'lightning-west-main': return 'west';
    default: return null;
  }
}

function lightningAtMainPeak(direction: LightningDirection, tick: number): LightningStrike {
  const startTick = tick - 30;
  const mainStartTick = tick - 4;
  const mainDurationTicks = 12;
  return {
    id: 1,
    startTick,
    direction,
    pulses: [
      { kind: 'preflash', startTick, durationTicks: 5 },
      { kind: 'preflash', startTick: startTick + 12, durationTicks: 5 },
      { kind: 'main', startTick: mainStartTick, durationTicks: mainDurationTicks },
    ],
    thunderTick: mainStartTick + mainDurationTicks + 30,
    thunderVariant: 0,
  };
}

function lightningGhostPosition(direction: LightningDirection): { x: number; z: number } {
  switch (direction) {
    case 'north': return { x: 0, z: 6.7 };
    case 'east': return { x: 10.45, z: 0 };
    case 'south': return { x: 0, z: -6.7 };
    case 'west': return { x: -10.45, z: 0 };
  }
}

function child(
  playerId: string,
  slot: number,
  x: number,
  z: number,
  facingRadians: number,
  headlamp: VisibleChild['headlamp'],
  flashlightOn: boolean,
): VisibleChild {
  return {
    playerId,
    slot,
    position: { x, z },
    facingRadians,
    headlamp,
    flashlightOn,
    batteryCharge: slot === 0 ? 0.58 : 0.82,
  };
}

function cloneChildren(children: readonly VisibleChild[]): VisibleChild[] {
  return children.map((visibleChild) => ({
    ...visibleChild,
    position: { ...visibleChild.position },
  }));
}

function cloneDolls(dolls: readonly VisibleDoll[]): VisibleDoll[] {
  return dolls.map((doll) => ({ ...doll, position: { ...doll.position } }));
}
