import { DEFAULT_HOUSE_MAP } from '../game/defaultHouse';
import { mapPositionIsOpen } from '../game/MapCollision';
import {
  DEFAULT_GAMEPLAY_TUNING,
  MATCH_RULES,
  type GameplayTuning,
  type Vec2,
} from '../game/MatchEngine';
import type {
  ChildViewerFrame,
  GhostViewerFrame,
  SharedMatchFrame,
  ViewerFrame,
  VisibleBattery,
  VisibleChild,
  VisibleDoll,
  VisibleGhost,
} from '../game/ViewerFrame';

export interface PresentationStats {
  corrections: number;
  hardSnaps: number;
  interpolationAlpha: number;
  bufferedFrames: number;
  bufferLeadMs: number;
  bufferUnderruns: number;
}

const REMOTE_BUFFER_TICKS = 6;
const MAX_BUFFERED_FRAMES = 12;
const MAX_CONTINUOUS_FRAME_GAP_TICKS = 30;
const MAX_REMOTE_PLAYBACK_RATE = 1.5;
const REMOTE_CATCHUP_GAIN = 0.25;
const SOFT_CORRECTION_DISTANCE = 0.35;
const HARD_CORRECTION_DISTANCE = 1.25;
const SOFT_CORRECTION_RATIO = 0.35;

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type CloneMode<Value> = Exclude<Value, null | undefined> extends Primitive ? 'value' : 'clone';
type ClonePolicy<Shape> = { [Key in keyof Shape]-?: CloneMode<Shape[Key]> };
type CaptureFrame = NonNullable<SharedMatchFrame['capture']>;

// Compile-time only: `satisfies` turns every ViewerFrame schema change into a clone decision.
void ({
  childFrame: {
    tick: 'value',
    phase: 'value',
    winner: 'value',
    remainingTicks: 'value',
    captureCount: 'value',
    ghostHealth: 'value',
    capture: 'clone',
    viewerRole: 'value',
    viewerPlayerId: 'value',
    ownBattery: 'value',
    children: 'clone',
    dolls: 'clone',
    batteries: 'clone',
    ghost: 'clone',
    battery: 'clone',
  },
  ghostFrame: {
    tick: 'value',
    phase: 'value',
    winner: 'value',
    remainingTicks: 'value',
    captureCount: 'value',
    ghostHealth: 'value',
    capture: 'clone',
    viewerRole: 'value',
    viewerPlayerId: 'value',
    ghost: 'clone',
    children: 'clone',
    dolls: 'clone',
    batteries: 'clone',
    battery: 'clone',
  },
  child: {
    playerId: 'value',
    slot: 'value',
    position: 'clone',
    facingRadians: 'value',
    headlamp: 'value',
    flashlightOn: 'value',
    batteryCharge: 'value',
  },
  doll: {
    dollId: 'value',
    slot: 'value',
    position: 'clone',
    headlamp: 'value',
  },
  ghost: {
    position: 'clone',
    facingRadians: 'value',
    burning: 'value',
    burnTicksRemaining: 'value',
  },
  battery: {
    batteryId: 'value',
    position: 'clone',
  },
  capture: {
    childPlayerId: 'value',
    ticksRemaining: 'value',
    durationTicks: 'value',
  },
  position: {
    x: 'value',
    z: 'value',
  },
} as const satisfies {
  childFrame: ClonePolicy<ChildViewerFrame>;
  ghostFrame: ClonePolicy<GhostViewerFrame>;
  child: ClonePolicy<VisibleChild>;
  doll: ClonePolicy<VisibleDoll>;
  ghost: ClonePolicy<VisibleGhost>;
  battery: ClonePolicy<VisibleBattery>;
  capture: ClonePolicy<CaptureFrame>;
  position: ClonePolicy<Vec2>;
});

export class FramePresenter {
  private matchId: string | null = null;
  private current: ViewerFrame | null = null;
  private bufferedFrames: ViewerFrame[] = [];
  private presentationTick: number | null = null;
  private playbackStarted = false;
  private bufferUnderruns = 0;
  private bufferUnderrunActive = false;
  private predictedPosition: Vec2 | null = null;
  private corrections = 0;
  private hardSnaps = 0;
  private interpolationAlpha = 1;

  ingest(matchId: string, frame: ViewerFrame): void {
    if (
      this.matchId !== matchId ||
      !this.current ||
      this.current.viewerPlayerId !== frame.viewerPlayerId ||
      this.current.viewerRole !== frame.viewerRole
    ) {
      this.reset(matchId, frame);
      return;
    }
    if (frame.tick <= this.current.tick) return;
    if (
      frame.phase !== this.current.phase ||
      frame.tick - this.current.tick > MAX_CONTINUOUS_FRAME_GAP_TICKS
    ) {
      this.reset(matchId, frame);
      return;
    }

    const serverPosition = ownPosition(frame);
    if (serverPosition) {
      if (!this.predictedPosition || frame.phase !== 'playing') {
        this.predictedPosition = { ...serverPosition };
      } else {
        const errorX = serverPosition.x - this.predictedPosition.x;
        const errorZ = serverPosition.z - this.predictedPosition.z;
        const error = Math.hypot(errorX, errorZ);
        if (error > HARD_CORRECTION_DISTANCE) {
          this.predictedPosition = { ...serverPosition };
          this.hardSnaps += 1;
        } else if (error > SOFT_CORRECTION_DISTANCE) {
          this.predictedPosition.x += errorX * SOFT_CORRECTION_RATIO;
          this.predictedPosition.z += errorZ * SOFT_CORRECTION_RATIO;
          this.corrections += 1;
        }
      }
    }

    const snapshot = cloneAuthorityFrame(frame);
    this.current = snapshot;
    this.bufferedFrames.push(snapshot);
    if (this.bufferedFrames.length > MAX_BUFFERED_FRAMES) {
      this.bufferedFrames.splice(0, this.bufferedFrames.length - MAX_BUFFERED_FRAMES);
      this.presentationTick = Math.max(
        this.presentationTick ?? snapshot.tick,
        this.bufferedFrames[0].tick,
      );
    }
  }

  present(
    deltaSeconds: number,
    movement: Vec2,
    movementTuning: Pick<GameplayTuning, 'childMoveSpeed' | 'ghostMoveSpeed'> = DEFAULT_GAMEPLAY_TUNING,
  ): ViewerFrame | null {
    if (!this.current) return null;
    const frame = this.presentBufferedFrame(Math.max(0, deltaSeconds));

    if (this.predictedPosition) {
      if (frame.phase === 'playing') {
        const magnitude = Math.hypot(movement.x, movement.z);
        if (magnitude > 0) {
          const speed = frame.viewerRole === 'ghost'
            ? movementTuning.ghostMoveSpeed
              * (frame.ghost.burning ? MATCH_RULES.illuminatedGhostSpeedMultiplier : 1)
            : movementTuning.childMoveSpeed;
          this.predictedPosition = movePredictedPosition(
            this.predictedPosition,
            { x: movement.x / magnitude, z: movement.z / magnitude },
            speed * Math.min(deltaSeconds, 0.05),
          );
        }
      }
      setOwnPosition(frame, this.predictedPosition);
    }
    return frame;
  }

  stats(): PresentationStats {
    return {
      corrections: this.corrections,
      hardSnaps: this.hardSnaps,
      interpolationAlpha: this.interpolationAlpha,
      bufferedFrames: this.bufferedFrames.length,
      bufferLeadMs: this.bufferLeadMs(),
      bufferUnderruns: this.bufferUnderruns,
    };
  }

  reset(matchId: string, frame: ViewerFrame): void {
    this.matchId = matchId;
    this.current = cloneAuthorityFrame(frame);
    this.bufferedFrames = [this.current];
    this.presentationTick = frame.tick;
    this.playbackStarted = false;
    this.bufferUnderrunActive = false;
    const position = ownPosition(frame);
    this.predictedPosition = position ? { ...position } : null;
    this.interpolationAlpha = 1;
  }

  private presentBufferedFrame(deltaSeconds: number): ViewerFrame {
    const latest = this.bufferedFrames[this.bufferedFrames.length - 1];
    this.presentationTick ??= latest.tick;
    if (!this.playbackStarted && latest.tick - this.presentationTick >= REMOTE_BUFFER_TICKS) {
      this.playbackStarted = true;
      this.presentationTick = Math.max(
        this.presentationTick,
        latest.tick - REMOTE_BUFFER_TICKS,
      );
    }
    if (this.playbackStarted) {
      const leadTicks = latest.tick - this.presentationTick;
      const excessLeadRatio = Math.max(0, leadTicks - REMOTE_BUFFER_TICKS) / REMOTE_BUFFER_TICKS;
      const playbackRate = Math.min(
        MAX_REMOTE_PLAYBACK_RATE,
        1 + excessLeadRatio * REMOTE_CATCHUP_GAIN,
      );
      const nextTick = this.presentationTick
        + deltaSeconds * MATCH_RULES.tickRate * playbackRate;
      if (nextTick <= latest.tick) {
        this.presentationTick = nextTick;
        this.bufferUnderrunActive = false;
      } else {
        this.presentationTick = latest.tick;
        if (!this.bufferUnderrunActive) {
          this.bufferUnderruns += 1;
          this.bufferUnderrunActive = true;
        }
      }
    }

    let before = this.bufferedFrames[0];
    let after = before;
    for (let index = 1; index < this.bufferedFrames.length; index += 1) {
      const candidate = this.bufferedFrames[index];
      if (candidate.tick >= this.presentationTick) {
        after = candidate;
        break;
      }
      before = candidate;
      after = candidate;
    }
    const tickSpan = after.tick - before.tick;
    this.interpolationAlpha = tickSpan > 0
      ? clamp((this.presentationTick - before.tick) / tickSpan, 0, 1)
      : 1;
    const frame = cloneFrame(after);
    if (before !== after) interpolateRemoteActors(frame, before, this.interpolationAlpha);

    while (
      this.bufferedFrames.length > 2 &&
      this.bufferedFrames[1].tick <= this.presentationTick
    ) {
      this.bufferedFrames.shift();
    }
    return frame;
  }

  private bufferLeadMs(): number {
    if (this.presentationTick === null || this.bufferedFrames.length === 0) return 0;
    const latestTick = this.bufferedFrames[this.bufferedFrames.length - 1].tick;
    return ((latestTick - this.presentationTick) / MATCH_RULES.tickRate) * 1_000;
  }
}

export function movePredictedPosition(position: Vec2, direction: Vec2, distance: number): Vec2 {
  const result = { ...position };
  const steps = Math.max(1, Math.ceil(Math.abs(distance) / 0.1));
  const stepDistance = distance / steps;
  for (let step = 0; step < steps; step += 1) {
    const xCandidate = { x: result.x + direction.x * stepDistance, z: result.z };
    if (positionIsOpen(xCandidate)) result.x = xCandidate.x;
    const zCandidate = { x: result.x, z: result.z + direction.z * stepDistance };
    if (positionIsOpen(zCandidate)) result.z = zCandidate.z;
  }
  return result;
}

function positionIsOpen(position: Vec2): boolean {
  return mapPositionIsOpen(DEFAULT_HOUSE_MAP, position, MATCH_RULES.playerRadius);
}

function interpolateRemoteActors(target: ViewerFrame, previous: ViewerFrame, alpha: number): void {
  for (const child of target.children) {
    if (child.playerId === target.viewerPlayerId) continue;
    const before = previous.children.find((candidate) => candidate.playerId === child.playerId);
    if (before) child.position = interpolatePosition(before.position, child.position, alpha);
  }
  for (const doll of target.dolls) {
    const before = previous.dolls.find((candidate) => candidate.dollId === doll.dollId);
    if (before) doll.position = interpolatePosition(before.position, doll.position, alpha);
  }
  if (target.viewerRole === 'child' && target.ghost && previous.viewerRole === 'child' && previous.ghost) {
    target.ghost.position = interpolatePosition(previous.ghost.position, target.ghost.position, alpha);
  }
  if (target.battery && previous.battery && target.battery.batteryId === previous.battery.batteryId) {
    target.battery.position = interpolatePosition(previous.battery.position, target.battery.position, alpha);
  }
}

function interpolatePosition(before: Vec2, after: Vec2, alpha: number): Vec2 {
  return {
    x: before.x + (after.x - before.x) * alpha,
    z: before.z + (after.z - before.z) * alpha,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function ownPosition(frame: ViewerFrame): Vec2 | null {
  if (frame.viewerRole === 'ghost') return frame.ghost.position;
  return frame.children.find((child) => child.playerId === frame.viewerPlayerId)?.position ?? null;
}

function setOwnPosition(frame: ViewerFrame, position: Vec2): void {
  if (frame.viewerRole === 'ghost') {
    frame.ghost.position = { ...position };
    return;
  }
  const own = frame.children.find((child) => child.playerId === frame.viewerPlayerId);
  if (own) own.position = { ...position };
}

function cloneFrame<T extends ViewerFrame>(frame: T): T {
  const batteries = frame.batteries.map((battery) => cloneBattery(battery));
  const shared = {
    ...frame,
    capture: frame.capture ? { ...frame.capture } : null,
    children: frame.children.map((child) => ({
      ...child,
      position: { ...child.position },
    })),
    dolls: frame.dolls.map((doll) => ({
      ...doll,
      position: { ...doll.position },
    })),
    batteries,
  };
  if (frame.viewerRole === 'ghost') {
    return {
      ...shared,
      ghost: cloneGhost(frame.ghost),
      battery: cloneSelectedBattery(frame.battery, frame.batteries, batteries),
    } as T;
  }
  return {
    ...shared,
    ...(frame.ghost ? { ghost: cloneGhost(frame.ghost) } : {}),
    ...(frame.battery
      ? { battery: cloneSelectedBattery(frame.battery, frame.batteries, batteries) }
      : {}),
  } as T;
}

function cloneAuthorityFrame<T extends ViewerFrame>(frame: T): T {
  const snapshot = cloneFrame(frame);
  return import.meta.env?.DEV ? deepFreeze(snapshot) : snapshot;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function cloneGhost(ghost: VisibleGhost): VisibleGhost {
  return {
    ...ghost,
    position: { ...ghost.position },
  };
}

function cloneBattery(battery: VisibleBattery): VisibleBattery {
  return {
    ...battery,
    position: { ...battery.position },
  };
}

function cloneSelectedBattery(
  selected: VisibleBattery | null,
  sourceBatteries: readonly VisibleBattery[],
  clonedBatteries: readonly VisibleBattery[],
): VisibleBattery | null {
  if (!selected) return null;
  const sourceIndex = sourceBatteries.indexOf(selected);
  return sourceIndex >= 0 ? clonedBatteries[sourceIndex] : cloneBattery(selected);
}
