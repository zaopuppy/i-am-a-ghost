import { DEFAULT_HOUSE_MAP, HOUSE_ROOMS } from '../game/defaultHouse';
import {
  MATCH_RULES,
  MatchEngine,
  type HeadlampBand,
  type MatchCheckpoint,
  type MatchMap,
  type PlayerCheckpoint,
  type PlayerCommand,
  type Vec2,
} from '../game/MatchEngine';

export interface BotMatchOptions {
  childCount: number;
  seed: number;
}

export interface BotMatchMetrics {
  seed: number;
  childCount: number;
  winner: 'children' | 'ghost';
  effectiveDurationSeconds: number;
  wallDurationSeconds: number;
  firstCaptureSeconds: number | null;
  thirdCaptureSeconds: number | null;
  firstBeamHitSeconds: number | null;
  effectiveBeamSeconds: number;
  batterySpawns: number;
  batteryCollections: number;
  averageBatteryPickupDelaySeconds: number | null;
  averageBatteryDepletions: number;
  doorwayBlockEpisodes: number;
  captureMisses: number;
  warningBandSeconds: Record<HeadlampBand, number>;
  minimumHumanDistance: number;
  permanentOverlap: boolean;
  wallPenetrations: number;
  softlockWindows: number;
  finalGhostHealth: number;
  finalCaptureCount: number;
}

interface BotMemory {
  patrolIndex: number;
  lastCaptureAction: boolean;
  doorwayBlockedTicks: Map<string, number>;
  doorwayBlockActive: Set<string>;
  depletionCounts: Map<string, number>;
  previousBatteries: Map<string, number>;
  spawnedBatteryTicks: Map<string, number>;
}

const DOORWAYS: readonly Vec2[] = [
  { x: -5, z: -4.8 }, { x: -5, z: 2 }, { x: -5, z: 7.9 },
  { x: 5, z: -6.7 }, { x: 5, z: 0 }, { x: 5, z: 6.3 },
  { x: -11, z: -3.5 }, { x: -2, z: -3.5 }, { x: 8, z: -3.5 },
  { x: -8, z: 3.5 }, { x: 1, z: 3.5 }, { x: 11, z: 3.5 },
];

const PATROL_POINTS: readonly Vec2[] = [
  ...HOUSE_ROOMS.map((room) => room.center),
  ...DEFAULT_HOUSE_MAP.batterySpawns,
];

export function runBotMatch(options: BotMatchOptions): BotMatchMetrics {
  if (!Number.isInteger(options.childCount) || options.childCount < 1 || options.childCount > 4) {
    throw new RangeError('Bot matches require one to four child players.');
  }
  const childIds = Array.from({ length: options.childCount }, (_, index) => `child-${index + 1}`);
  const engine = new MatchEngine({
    seed: options.seed,
    map: DEFAULT_HOUSE_MAP,
    ghostPlayerId: 'ghost',
    childPlayerIds: childIds,
  });
  const navigator = new GridNavigator(DEFAULT_HOUSE_MAP);
  const memory: BotMemory = {
    patrolIndex: Math.abs(options.seed) % PATROL_POINTS.length,
    lastCaptureAction: false,
    doorwayBlockedTicks: new Map(),
    doorwayBlockActive: new Set(),
    depletionCounts: new Map(childIds.map((id) => [id, 0])),
    previousBatteries: new Map(childIds.map((id) => [id, 1])),
    spawnedBatteryTicks: new Map(),
  };
  let checkpoint = engine.checkpoint();
  let firstCaptureTick: number | null = null;
  let thirdCaptureTick: number | null = null;
  let firstBeamTick: number | null = null;
  let beamTicks = 0;
  let batterySpawns = 0;
  let batteryCollections = 0;
  let captureMisses = 0;
  const batteryPickupDelayTicks: number[] = [];
  const warningTicks: Record<HeadlampBand, number> = { off: 0, slow: 0, fast: 0, solid: 0 };
  let doorwayBlockEpisodes = 0;
  let minimumHumanDistance = Number.POSITIVE_INFINITY;
  let overlapTicks = 0;
  let permanentOverlap = false;
  let wallPenetrations = 0;
  let globalStagnantTicks = 0;
  let softlockWindows = 0;
  let previousProgress = progressValue(checkpoint);
  const maximumWallTicks = MATCH_RULES.matchDurationTicks
    + 3 * MATCH_RULES.captureAnimationTicks
    + 2 * MATCH_RULES.protectionTicks
    + MATCH_RULES.tickRate * 10;

  for (let wallTick = 0; wallTick < maximumWallTicks && checkpoint.phase !== 'ended'; wallTick += 1) {
    const before = checkpoint;
    const commands = createBotCommands(before, navigator, memory, options.seed);
    const result = engine.advance(commands);
    checkpoint = result.checkpoint;

    for (const player of checkpoint.players) {
      if (player.role === 'child' && player.headlamp) warningTicks[player.headlamp] += 1;
    }
    if (checkpoint.ghostRevealed) {
      beamTicks += 1;
      firstBeamTick ??= checkpoint.tick;
    }
    for (const event of result.events) {
      if (event.type === 'child-captured') {
        firstCaptureTick ??= event.tick;
        if (event.captureCount === 3) thirdCaptureTick = event.tick;
      } else if (event.type === 'capture-missed') {
        captureMisses += 1;
      } else if (event.type === 'battery-spawned') {
        batterySpawns += 1;
        memory.spawnedBatteryTicks.set(event.battery.id, event.tick);
      } else if (event.type === 'battery-collected') {
        batteryCollections += 1;
        const spawnedAt = memory.spawnedBatteryTicks.get(event.batteryId);
        if (spawnedAt !== undefined) batteryPickupDelayTicks.push(event.tick - spawnedAt);
      }
    }
    trackDepletions(checkpoint, memory);
    doorwayBlockEpisodes += trackDoorwayBlocks(before, checkpoint, commands, memory);

    const distance = minimumPlayerDistance(checkpoint.players.filter((player) => player.active));
    wallPenetrations += checkpoint.players.filter(
      (player) => player.active && !pointIsOpen(player.position, DEFAULT_HOUSE_MAP),
    ).length;
    minimumHumanDistance = Math.min(minimumHumanDistance, distance);
    if (distance < MATCH_RULES.playerRadius * 2 - 0.001) {
      overlapTicks += 1;
      if (overlapTicks > MATCH_RULES.tickRate / 2) permanentOverlap = true;
    } else {
      overlapTicks = 0;
    }

    const moved = totalMovement(before, checkpoint);
    const progress = progressValue(checkpoint);
    if (checkpoint.phase === 'playing' && moved < 0.002 && progress === previousProgress) {
      globalStagnantTicks += 1;
      if (globalStagnantTicks === MATCH_RULES.tickRate * 5) softlockWindows += 1;
    } else {
      globalStagnantTicks = 0;
    }
    previousProgress = progress;
  }

  if (!checkpoint.winner) throw new Error(`Bot match ${options.seed} did not terminate.`);
  const warningDivisor = MATCH_RULES.tickRate * options.childCount;
  const pickupDelay = batteryPickupDelayTicks.length === 0
    ? null
    : average(batteryPickupDelayTicks) / MATCH_RULES.tickRate;
  const depletionTotal = [...memory.depletionCounts.values()].reduce((sum, value) => sum + value, 0);

  return {
    seed: options.seed,
    childCount: options.childCount,
    winner: checkpoint.winner,
    effectiveDurationSeconds:
      (MATCH_RULES.matchDurationTicks - checkpoint.remainingTicks) / MATCH_RULES.tickRate,
    wallDurationSeconds: checkpoint.tick / MATCH_RULES.tickRate,
    firstCaptureSeconds: secondsOrNull(firstCaptureTick),
    thirdCaptureSeconds: secondsOrNull(thirdCaptureTick),
    firstBeamHitSeconds: secondsOrNull(firstBeamTick),
    effectiveBeamSeconds: beamTicks / MATCH_RULES.tickRate,
    batterySpawns,
    batteryCollections,
    averageBatteryPickupDelaySeconds: pickupDelay,
    averageBatteryDepletions: depletionTotal / options.childCount,
    doorwayBlockEpisodes,
    captureMisses,
    warningBandSeconds: {
      off: warningTicks.off / warningDivisor,
      slow: warningTicks.slow / warningDivisor,
      fast: warningTicks.fast / warningDivisor,
      solid: warningTicks.solid / warningDivisor,
    },
    minimumHumanDistance: Number.isFinite(minimumHumanDistance) ? minimumHumanDistance : 0,
    permanentOverlap,
    wallPenetrations,
    softlockWindows,
    finalGhostHealth: checkpoint.ghostHealth,
    finalCaptureCount: checkpoint.captureCount,
  };
}

function createBotCommands(
  checkpoint: MatchCheckpoint,
  navigator: GridNavigator,
  memory: BotMemory,
  seed: number,
): PlayerCommand[] {
  const ghost = checkpoint.players.find((player) => player.role === 'ghost');
  if (!ghost) throw new Error('Bot checkpoint has no ghost.');
  if (checkpoint.phase !== 'playing') {
    memory.lastCaptureAction = false;
    return checkpoint.players.map((player) => command(player, { x: 0, z: 0 }, player.facingRadians, false));
  }

  const children = checkpoint.players.filter((player) => player.role === 'child' && player.active);
  const targetChild = [...children].sort((left, right) =>
    distanceBetween(left.position, ghost.position) - distanceBetween(right.position, ghost.position)
      || left.id.localeCompare(right.id))[0];
  const ghostMove = targetChild
    ? navigator.moveToward(ghost.id, ghost.position, targetChild.position, checkpoint.tick)
    : { x: 0, z: 0 };
  const ghostFacing = targetChild
    ? Math.atan2(targetChild.position.z - ghost.position.z, targetChild.position.x - ghost.position.x)
    : ghost.facingRadians;
  const canCapture = Boolean(
    targetChild
    && checkpoint.ghostAction.state === 'idle'
    && distanceBetween(ghost.position, targetChild.position) <= MATCH_RULES.captureRange * 0.94
    && navigator.hasLineOfSight(ghost.position, targetChild.position),
  );
  const captureAction = canCapture && !memory.lastCaptureAction;
  memory.lastCaptureAction = captureAction;
  const commands = [command(ghost, ghostMove, ghostFacing, captureAction)];

  for (const childPlayer of children) {
    const battery = childPlayer.battery ?? 0;
    const distanceToGhost = distanceBetween(childPlayer.position, ghost.position);
    const seesDanger = childPlayer.headlamp !== 'off';
    const lineToGhost = navigator.hasLineOfSight(childPlayer.position, ghost.position);
    let target: Vec2;
    let move: Vec2;

    if (checkpoint.battery && battery < 0.32 && childPlayer.headlamp !== 'solid') {
      target = checkpoint.battery.position;
      move = navigator.moveToward(childPlayer.id, childPlayer.position, target, checkpoint.tick);
    } else if (seesDanger) {
      target = ghost.position;
      if (distanceToGhost > 1.72) {
        move = navigator.moveToward(childPlayer.id, childPlayer.position, target, checkpoint.tick);
      } else if (distanceToGhost < 1.02) {
        move = normalized({
          x: childPlayer.position.x - ghost.position.x,
          z: childPlayer.position.z - ghost.position.z,
        });
      } else {
        const strafe = childPlayer.slot && childPlayer.slot % 2 === 1 ? 1 : -1;
        move = normalized({
          x: -(ghost.position.z - childPlayer.position.z) * strafe,
          z: (ghost.position.x - childPlayer.position.x) * strafe,
        });
      }
    } else {
      const slot = childPlayer.slot ?? 0;
      const patrolOffset = (memory.patrolIndex + slot * 5 + Math.abs(seed % 7)) % PATROL_POINTS.length;
      target = PATROL_POINTS[patrolOffset];
      if (distanceBetween(childPlayer.position, target) < 0.8) memory.patrolIndex += 1;
      move = navigator.moveToward(childPlayer.id, childPlayer.position, target, checkpoint.tick);
    }

    const facing = seesDanger
      ? Math.atan2(ghost.position.z - childPlayer.position.z, ghost.position.x - childPlayer.position.x)
      : Math.atan2(move.z, move.x);
    const patrolScan = !seesDanger && (checkpoint.tick + (childPlayer.slot ?? 0) * 37) % 180 < 36;
    const flashlight = battery > 0 && ((seesDanger && lineToGhost) || patrolScan);
    commands.push(command(childPlayer, move, Number.isFinite(facing) ? facing : 0, flashlight));
  }
  return commands;
}

function command(player: PlayerCheckpoint, move: Vec2, facingRadians: number, action: boolean): PlayerCommand {
  return { playerId: player.id, move, facingRadians, action };
}

class GridNavigator {
  private readonly nodes: Vec2[] = [];
  private readonly neighbors: number[][] = [];
  private readonly routes = new Map<string, { targetNode: number; plannedAt: number; nodes: number[] }>();

  constructor(private readonly map: MatchMap) {
    const spacing = 0.8;
    const grid = new Map<string, number>();
    let zIndex = 0;
    for (let z = map.bounds.minZ + 0.55; z <= map.bounds.maxZ - 0.55; z += spacing, zIndex += 1) {
      let xIndex = 0;
      for (let x = map.bounds.minX + 0.55; x <= map.bounds.maxX - 0.55; x += spacing, xIndex += 1) {
        const point = { x, z };
        if (!pointIsOpen(point, map)) continue;
        grid.set(`${xIndex}:${zIndex}`, this.nodes.length);
        this.nodes.push(point);
        this.neighbors.push([]);
      }
    }
    for (const [key, nodeIndex] of grid) {
      const [xIndex, currentZIndex] = key.split(':').map(Number);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const neighbor = grid.get(`${xIndex + dx}:${currentZIndex + dz}`);
        if (neighbor === undefined) continue;
        if (this.hasLineOfSight(this.nodes[nodeIndex], this.nodes[neighbor])) {
          this.neighbors[nodeIndex].push(neighbor);
        }
      }
    }
  }

  hasLineOfSight(from: Vec2, to: Vec2): boolean {
    return !this.map.walls.some((wall) => segmentIntersectsRectangle(from, to, {
      minX: wall.minX - MATCH_RULES.playerRadius,
      maxX: wall.maxX + MATCH_RULES.playerRadius,
      minZ: wall.minZ - MATCH_RULES.playerRadius,
      maxZ: wall.maxZ + MATCH_RULES.playerRadius,
    }));
  }

  moveToward(id: string, from: Vec2, to: Vec2, tick: number): Vec2 {
    if (this.hasLineOfSight(from, to)) return normalized({ x: to.x - from.x, z: to.z - from.z });
    const startNode = this.nearestNode(from);
    const targetNode = this.nearestNode(to);
    const existing = this.routes.get(id);
    if (!existing || existing.targetNode !== targetNode || tick - existing.plannedAt >= 45 || existing.nodes.length === 0) {
      this.routes.set(id, { targetNode, plannedAt: tick, nodes: this.findRoute(startNode, targetNode) });
    }
    const route = this.routes.get(id);
    if (!route) return { x: 0, z: 0 };
    while (route.nodes.length > 1 && distanceBetween(from, this.nodes[route.nodes[0]]) < 0.35) route.nodes.shift();
    const waypoint = this.nodes[route.nodes[0] ?? targetNode];
    return normalized({ x: waypoint.x - from.x, z: waypoint.z - from.z });
  }

  private nearestNode(position: Vec2): number {
    let nearest = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.nodes.length; index += 1) {
      const distance = distanceBetween(position, this.nodes[index]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = index;
      }
    }
    return nearest;
  }

  private findRoute(start: number, target: number): number[] {
    if (start === target) return [target];
    const previous = new Int32Array(this.nodes.length).fill(-1);
    const visited = new Uint8Array(this.nodes.length);
    const queue = new Int32Array(this.nodes.length);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const current = queue[head++];
      for (const neighbor of this.neighbors[current]) {
        if (visited[neighbor]) continue;
        visited[neighbor] = 1;
        previous[neighbor] = current;
        if (neighbor === target) {
          head = tail;
          break;
        }
        queue[tail++] = neighbor;
      }
    }
    if (!visited[target]) return [start];
    const route = [target];
    for (let current = target; current !== start;) {
      current = previous[current];
      route.push(current);
    }
    route.reverse();
    return route;
  }
}

function pointIsOpen(point: Vec2, map: MatchMap): boolean {
  const radius = MATCH_RULES.playerRadius;
  if (
    point.x - radius < map.bounds.minX || point.x + radius > map.bounds.maxX
    || point.z - radius < map.bounds.minZ || point.z + radius > map.bounds.maxZ
  ) return false;
  return !map.walls.some((wall) => {
    const x = Math.max(wall.minX, Math.min(point.x, wall.maxX));
    const z = Math.max(wall.minZ, Math.min(point.z, wall.maxZ));
    return distanceBetween(point, { x, z }) < radius;
  });
}

function trackDepletions(checkpoint: MatchCheckpoint, memory: BotMemory): void {
  for (const player of checkpoint.players) {
    if (player.role !== 'child' || player.battery === null) continue;
    const previous = memory.previousBatteries.get(player.id) ?? 1;
    if (previous > 0.001 && player.battery <= 0.001) {
      memory.depletionCounts.set(player.id, (memory.depletionCounts.get(player.id) ?? 0) + 1);
    }
    memory.previousBatteries.set(player.id, player.battery);
  }
}

function trackDoorwayBlocks(
  before: MatchCheckpoint,
  after: MatchCheckpoint,
  commands: readonly PlayerCommand[],
  memory: BotMemory,
): number {
  let episodes = 0;
  for (const current of after.players) {
    const previous = before.players.find((player) => player.id === current.id);
    const input = commands.find((candidate) => candidate.playerId === current.id);
    if (!previous || !input) continue;
    const trying = Math.hypot(input.move.x, input.move.z) > 0.5;
    const stalled = distanceBetween(previous.position, current.position) < 0.002;
    const nearDoor = DOORWAYS.some((doorway) => distanceBetween(current.position, doorway) < 1.35);
    const ticks = trying && stalled && nearDoor
      ? (memory.doorwayBlockedTicks.get(current.id) ?? 0) + 1
      : 0;
    memory.doorwayBlockedTicks.set(current.id, ticks);
    if (ticks >= 30 && !memory.doorwayBlockActive.has(current.id)) {
      memory.doorwayBlockActive.add(current.id);
      episodes += 1;
    }
    if (ticks === 0) memory.doorwayBlockActive.delete(current.id);
  }
  return episodes;
}

function totalMovement(before: MatchCheckpoint, after: MatchCheckpoint): number {
  return after.players.reduce((sum, player) => {
    const previous = before.players.find((candidate) => candidate.id === player.id);
    return sum + (previous ? distanceBetween(previous.position, player.position) : 0);
  }, 0);
}

function minimumPlayerDistance(players: readonly PlayerCheckpoint[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let left = 0; left < players.length; left += 1) {
    for (let right = left + 1; right < players.length; right += 1) {
      minimum = Math.min(minimum, distanceBetween(players[left].position, players[right].position));
    }
  }
  return minimum;
}

function progressValue(checkpoint: MatchCheckpoint): string {
  return `${checkpoint.captureCount}:${checkpoint.ghostHealth.toFixed(3)}:${checkpoint.remainingTicks}`;
}

function normalized(vector: Vec2): Vec2 {
  const length = Math.hypot(vector.x, vector.z);
  return length > 1e-6 ? { x: vector.x / length, z: vector.z / length } : { x: 0, z: 0 };
}

function distanceBetween(left: Vec2, right: Vec2): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

function secondsOrNull(tick: number | null): number | null {
  return tick === null ? null : tick / MATCH_RULES.tickRate;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function segmentIntersectsRectangle(
  start: Vec2,
  end: Vec2,
  rectangle: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  let tMinimum = 0;
  let tMaximum = 1;
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  for (const [origin, delta, minimum, maximum] of [
    [start.x, deltaX, rectangle.minX, rectangle.maxX],
    [start.z, deltaZ, rectangle.minZ, rectangle.maxZ],
  ] as const) {
    if (Math.abs(delta) < 1e-9) {
      if (origin >= minimum && origin <= maximum) continue;
      return false;
    }
    const first = (minimum - origin) / delta;
    const second = (maximum - origin) / delta;
    const near = Math.min(first, second);
    const far = Math.max(first, second);
    tMinimum = Math.max(tMinimum, near);
    tMaximum = Math.min(tMaximum, far);
    if (tMinimum > tMaximum) return false;
  }
  return true;
}
