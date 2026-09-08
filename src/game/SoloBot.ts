import { GridNavigator } from './GridNavigator';
import { mapPositionIsOpen, mapSegmentIsOpen } from './MapCollision';
import { DEFAULT_GAMEPLAY_TUNING, MATCH_RULES, type GameplayTuning, type MatchMap, type PlayerCommand, type Vec2 } from './MatchEngine';
import type { ViewerFrame } from './ViewerFrame';

const THINK_TICKS = 15;
const MEMORY_TICKS = 180;
const SIGHT_RANGE = 12;
const TURN_RADIANS_PER_SECOND = 5;
const SCAN_RADIANS_PER_SECOND = 1.6;

/** Receives only a viewer projection: hidden authority positions cannot enter bot memory. */
export class SoloBot {
  private target: Vec2 | null = null;
  private lastSeenTick = -MEMORY_TICKS;
  private patrolIndex: number;
  private nextThinkTick = 0;
  private captureCount = 0;
  private intention: PlayerCommand;
  private destination: Vec2 | null = null;
  private lookAt: Vec2 | null = null;
  private scanning = false;
  private readonly patrol: readonly Vec2[];

  constructor(
    private readonly playerId: string,
    private readonly map: MatchMap,
    private readonly navigator: GridNavigator,
    private readonly offset: number,
  ) {
    this.patrol = [map.ghostSpawn, ...map.childSpawns, ...map.batterySpawns]
      .filter((point) => mapPositionIsOpen(map, point, MATCH_RULES.playerRadius, MATCH_RULES.mapCollisionRadius));
    this.patrolIndex = Math.abs(offset) % this.patrol.length;
    this.intention = { playerId, move: { x: 0, z: 0 }, facingRadians: 0, action: false };
  }

  command(frame: ViewerFrame, tuning: Readonly<GameplayTuning> = DEFAULT_GAMEPLAY_TUNING): PlayerCommand {
    const own = frame.viewerRole === 'ghost'
      ? frame.ghost
      : frame.children.find((child) => child.playerId === this.playerId)!;
    if (frame.captureCount !== this.captureCount) {
      this.captureCount = frame.captureCount;
      this.target = null;
      this.nextThinkTick = frame.tick;
    }
    if (frame.phase === 'ended' || frame.phase === 'capture-animation') {
      this.nextThinkTick = frame.tick + THINK_TICKS;
      return { playerId: this.playerId, move: { x: 0, z: 0 }, facingRadians: own.facingRadians, action: false };
    }
    if (frame.tick >= this.nextThinkTick) {
      this.nextThinkTick = frame.tick + THINK_TICKS;
      this.intention = this.think(frame, own.position, own.facingRadians, tuning);
    }
    const move = this.destination
      ? this.navigator.moveToward(this.playerId, own.position, this.destination, frame.tick)
      : { x: 0, z: 0 };
    const desiredFacing = this.lookAt
      ? Math.atan2(this.lookAt.z - own.position.z, this.lookAt.x - own.position.x)
      : this.scanning
        ? own.facingRadians + SCAN_RADIANS_PER_SECOND / MATCH_RULES.tickRate
        : Math.hypot(move.x, move.z) > 0.01 ? Math.atan2(move.z, move.x) : own.facingRadians;
    const difference = desiredFacing - own.facingRadians;
    const shortest = Math.atan2(Math.sin(difference), Math.cos(difference));
    const maximumTurn = TURN_RADIANS_PER_SECOND / MATCH_RULES.tickRate;
    const facing = own.facingRadians + Math.max(-maximumTurn, Math.min(maximumTurn, shortest));
    return { ...this.intention, move, facingRadians: Math.atan2(Math.sin(facing), Math.cos(facing)) };
  }

  private think(frame: ViewerFrame, position: Vec2, facing: number, tuning: Readonly<GameplayTuning>): PlayerCommand {
    const visible = frame.viewerRole === 'ghost'
      ? frame.children.filter((child) => this.canSee(position, child.position))
        .sort((a, b) => distance(position, a.position) - distance(position, b.position))[0]?.position
      : frame.ghost && this.canSee(position, frame.ghost.position) ? frame.ghost.position : undefined;
    if (visible) {
      this.target = { ...visible };
      this.lastSeenTick = frame.tick;
    } else if (frame.tick - this.lastSeenTick > MEMORY_TICKS
      || (this.target && distance(position, this.target) < 0.65)) {
      this.target = null;
    }
    let destination = this.target ?? this.patrol[this.patrolIndex];
    let action = false;
    let aim: Vec2 | null = this.target;
    this.scanning = false;

    if (frame.viewerRole === 'child') {
      const own = frame.children.find((child) => child.playerId === this.playerId)!;
      const danger = own.headlamp !== 'off';
      const nearestBattery = [...frame.batteries]
        .sort((a, b) => distance(position, a.position) - distance(position, b.position))[0];
      if (visible) {
        const range = distance(position, visible);
        action = frame.ownBattery > 0 && range < tuning.flashlightLength;
        if (range < Math.min(3.2, tuning.flashlightLength * 0.43) || frame.ownBattery < 0.08) {
          destination = this.escape(position, visible);
        } else if (range < Math.min(5.5, tuning.flashlightLength * 0.73)) {
          // Hold a useful beam distance instead of alternating approach/retreat
          // around one threshold on every decision tick.
          destination = position;
        }
      } else if (nearestBattery && frame.ownBattery < 0.4 && own.headlamp !== 'solid') {
        destination = nearestBattery.position;
      } else if (!this.target) {
        // Visible nearby beams are a call for help, not a shared hidden ghost coordinate.
        const ally = frame.children.find((child) => child.playerId !== this.playerId
          && child.flashlightOn && distance(position, child.position) > 2
          && distance(position, child.position) < 7 && this.canSee(position, child.position));
        if (ally) destination = ally.position;
      }
      if (!visible && danger && frame.ownBattery > 0) {
        // Headlamps give distance only. Sweep independently of the hidden ghost's direction.
        this.scanning = true;
        aim = null;
        action = (frame.tick + this.offset * 17) % 120 < 72;
      } else if (!visible && this.target) {
        action = frame.ownBattery > 0 && distance(position, this.target) < tuning.flashlightLength;
      }
    } else if (frame.ghost.burning && visible) {
      destination = this.escape(position, visible);
    }

    if (!this.target && distance(position, this.patrol[this.patrolIndex]) < 0.8) {
      this.patrolIndex = (this.patrolIndex + 1) % this.patrol.length;
      destination = this.patrol[this.patrolIndex];
    }
    this.destination = { ...destination };
    this.lookAt = aim ? { ...aim } : null;
    const move = this.navigator.moveToward(this.playerId, position, destination, frame.tick);
    if (aim) facing = Math.atan2(aim.z - position.z, aim.x - position.x);
    else if (!action && Math.hypot(move.x, move.z) > 0.01) facing = Math.atan2(move.z, move.x);
    return { playerId: this.playerId, move, facingRadians: facing, action: action && frame.phase === 'playing' };
  }

  private canSee(from: Vec2, to: Vec2): boolean {
    return distance(from, to) <= SIGHT_RANGE && mapSegmentIsOpen(this.map, from, to, 0);
  }

  private escape(position: Vec2, threat: Vec2): Vec2 {
    let best = position;
    let score = distance(position, threat);
    for (let index = 0; index < 12; index += 1) {
      const angle = index * Math.PI / 6;
      const candidate = { x: position.x + Math.cos(angle) * 2, z: position.z + Math.sin(angle) * 2 };
      if (!mapPositionIsOpen(this.map, candidate, MATCH_RULES.playerRadius, MATCH_RULES.mapCollisionRadius)
        || !this.navigator.hasLineOfSight(position, candidate)) continue;
      const nextScore = distance(candidate, threat);
      if (nextScore > score) {
        score = nextScore;
        best = candidate;
      }
    }
    return best;
  }
}

function distance(left: Vec2, right: Vec2): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
}
