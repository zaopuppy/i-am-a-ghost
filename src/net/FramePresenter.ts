import { DEFAULT_HOUSE_MAP } from '../game/defaultHouse';
import {
  DEFAULT_MOVEMENT_TUNING,
  MATCH_RULES,
  type MovementTuning,
  type Vec2,
} from '../game/MatchEngine';
import type { ViewerFrame } from '../game/ViewerFrame';

export interface PresentationStats {
  corrections: number;
  hardSnaps: number;
  interpolationAlpha: number;
}

export class FramePresenter {
  private matchId: string | null = null;
  private previous: ViewerFrame | null = null;
  private current: ViewerFrame | null = null;
  private transitionSeconds = 1 / 20;
  private transitionElapsed = 0;
  private predictedPosition: Vec2 | null = null;
  private corrections = 0;
  private hardSnaps = 0;
  private interpolationAlpha = 1;

  ingest(matchId: string, frame: ViewerFrame): void {
    if (
      this.matchId !== matchId ||
      !this.current ||
      this.current.viewerPlayerId !== frame.viewerPlayerId ||
      this.current.viewerRole !== frame.viewerRole ||
      frame.tick <= this.current.tick
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
        if (error > 1.25) {
          this.predictedPosition = { ...serverPosition };
          this.hardSnaps += 1;
        } else if (error > 0.025) {
          this.predictedPosition.x += errorX * 0.35;
          this.predictedPosition.z += errorZ * 0.35;
          this.corrections += 1;
        }
      }
    }

    this.previous = this.current;
    this.current = cloneFrame(frame);
    this.transitionSeconds = Math.max(1 / 30, Math.min(0.12, (frame.tick - this.previous.tick) / 60));
    this.transitionElapsed = 0;
  }

  present(
    deltaSeconds: number,
    movement: Vec2,
    movementTuning: Readonly<MovementTuning> = DEFAULT_MOVEMENT_TUNING,
  ): ViewerFrame | null {
    if (!this.current) return null;
    this.transitionElapsed += Math.max(0, deltaSeconds);
    const linearAlpha = Math.min(1, this.transitionElapsed / this.transitionSeconds);
    this.interpolationAlpha = linearAlpha * linearAlpha * (3 - 2 * linearAlpha);
    const frame = cloneFrame(this.current);
    if (this.previous) interpolateRemoteActors(frame, this.previous, this.interpolationAlpha);

    if (this.predictedPosition) {
      if (frame.phase === 'playing') {
        const magnitude = Math.hypot(movement.x, movement.z);
        if (magnitude > 0) {
          const speed = frame.viewerRole === 'ghost'
            ? movementTuning.ghostMoveSpeed
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
    };
  }

  reset(matchId: string, frame: ViewerFrame): void {
    this.matchId = matchId;
    this.previous = cloneFrame(frame);
    this.current = cloneFrame(frame);
    const position = ownPosition(frame);
    this.predictedPosition = position ? { ...position } : null;
    this.transitionElapsed = this.transitionSeconds;
    this.interpolationAlpha = 1;
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
  const radius = MATCH_RULES.playerRadius;
  const { bounds } = DEFAULT_HOUSE_MAP;
  if (
    position.x - radius < bounds.minX ||
    position.x + radius > bounds.maxX ||
    position.z - radius < bounds.minZ ||
    position.z + radius > bounds.maxZ
  ) return false;
  return !DEFAULT_HOUSE_MAP.walls.some((wall) => {
    const closestX = Math.max(wall.minX, Math.min(position.x, wall.maxX));
    const closestZ = Math.max(wall.minZ, Math.min(position.z, wall.maxZ));
    return Math.hypot(position.x - closestX, position.z - closestZ) < radius;
  });
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
  return structuredClone(frame);
}
