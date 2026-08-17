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
  'ghost-playing',
  'low-battery',
  'capture',
  'protection',
  'child-win',
  'ghost-win',
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
  const common = {
    tick,
    remainingTicks: 13_800,
    captureCount: 1,
    ghostHealth: 62,
    winner: null,
    capture: null,
  } as const;

  if (state === 'ghost-playing' || state === 'ghost-win') {
    const ended = state === 'ghost-win';
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
      battery: { batteryId: 'battery-1', position: { x: 2.2, z: 0 } },
    };
    return frame;
  }

  const ended = state === 'child-win';
  const hidden = state === 'child-hidden' || state === 'protection';
  const phase = state === 'capture'
    ? 'capture-animation'
    : state === 'protection'
      ? 'protection'
      : ended
        ? 'ended'
        : 'playing';
  const children = state === 'child-hidden'
    ? cloneChildren(CHILDREN.slice(0, 2)).map((visibleChild) => ({ ...visibleChild, flashlightOn: false }))
    : cloneChildren(CHILDREN);

  return {
    ...common,
    phase,
    winner: ended ? 'children' : null,
    remainingTicks: ended ? 11_520 : common.remainingTicks,
    ghostHealth: ended ? 0 : common.ghostHealth,
    capture: state === 'capture'
      ? { childPlayerId: 'child-1', ticksRemaining: 92, durationTicks: 156 }
      : null,
    viewerRole: 'child',
    viewerPlayerId: 'child-1',
    ownBattery: state === 'low-battery' ? 0.08 : 0.58,
    children,
    dolls: hidden && children.length === 2 ? cloneDolls(DOLLS.slice(1)) : [],
    ...(!hidden ? { ghost: { ...GHOST, position: { ...GHOST.position } } } : {}),
    ...(state === 'low-battery'
      ? { battery: { batteryId: 'battery-1', position: { x: 5.8, z: 4.8 } } }
      : {}),
  };
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
  return { playerId, slot, position: { x, z }, facingRadians, headlamp, flashlightOn };
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
