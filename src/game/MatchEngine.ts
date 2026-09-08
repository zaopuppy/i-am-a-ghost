import { mapPositionIsOpen } from './MapCollision';
import { childMovementMultiplier } from './ChildMovement';

export interface Vec2 {
  x: number;
  z: number;
}

export type HeadlampBand = 'off' | 'slow' | 'fast' | 'solid';

export type LightningDirection = 'north' | 'east' | 'south' | 'west';

export interface LightningPulse {
  kind: 'preflash' | 'main';
  startTick: number;
  durationTicks: number;
}

export interface LightningStrike {
  id: number;
  startTick: number;
  direction: LightningDirection;
  pulses: LightningPulse[];
  thunderTick: number;
  thunderVariant: 0 | 1 | 2;
}

export interface LightningRevealCheckpoint {
  position: Vec2;
  facingRadians: number;
  ticksRemaining: number;
}

export interface MatchMap {
  id: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  walls: ReadonlyArray<{ id: string; minX: number; maxX: number; minZ: number; maxZ: number }>;
  movementObstacles?: ReadonlyArray<{
    id: string;
    center: Vec2;
    halfWidth: number;
    halfDepth: number;
    yawRadians: number;
  }>;
  ghostSpawn: Vec2;
  childSpawns: readonly [Vec2, Vec2, Vec2, Vec2];
  batterySpawns: ReadonlyArray<Vec2>;
}

export interface MatchSetup {
  seed: number;
  map: MatchMap;
  ghostPlayerId: string;
  childPlayerIds: readonly string[];
  gameplayTuning?: Partial<GameplayTuning>;
}

export interface GameplayTuning {
  childMoveSpeed: number;
  ghostMoveSpeed: number;
  headlampDetectionRange: number;
  flashlightLength: number;
  flashlightConeDegrees: number;
  infiniteGhostHealth: boolean;
  infiniteFlashlightEnergy: boolean;
}

export interface PlayerCommand {
  playerId: string;
  move: Vec2;
  facingRadians: number;
  action: boolean;
}

export interface PlayerCheckpoint {
  id: string;
  role: 'ghost' | 'child';
  slot: number | null;
  position: Vec2;
  facingRadians: number;
  battery: number | null;
  headlamp: HeadlampBand | null;
  active: boolean;
}

export interface DollCheckpoint {
  id: string;
  slot: number;
  position: Vec2;
  headlamp: HeadlampBand;
}

export interface BatteryCheckpoint {
  id: string;
  spawnIndex: number;
  position: Vec2;
}

export interface MatchCheckpoint {
  tick: number;
  phase: 'playing' | 'capture-animation' | 'protection' | 'ended';
  winner: 'children' | 'ghost' | null;
  remainingTicks: number;
  captureCount: number;
  phaseTicksRemaining: number;
  capturedChildPlayerId: string | null;
  captureContactChildPlayerId: string | null;
  captureContactTicks: number;
  ghostHealth: number;
  ghostRevealed: boolean;
  ghostBurnTicksRemaining: number;
  randomState: number;
  lightningRandomState: number;
  lightningPlayingTick: number;
  nextLightningPlayingTick: number;
  lightningSerial: number;
  lightning: LightningStrike | null;
  lightningReveal: LightningRevealCheckpoint | null;
  players: PlayerCheckpoint[];
  dolls: DollCheckpoint[];
  batteries: BatteryCheckpoint[];
  battery: BatteryCheckpoint | null;
}

type MatchEventPayload =
  | { type: 'round-reset' | 'protection-ended' }
  | { type: 'child-captured'; childPlayerId: string; captureCount: number }
  | { type: 'battery-spawned'; battery: BatteryCheckpoint }
  | { type: 'battery-collected'; batteryId: string; childPlayerId: string }
  | { type: 'lightning-started'; lightning: LightningStrike }
  | { type: 'match-ended'; winner: 'children' | 'ghost' };

export type MatchEvent = MatchEventPayload & { id: number; tick: number };

export interface MatchAdvanceResult {
  checkpoint: MatchCheckpoint;
  events: MatchEvent[];
}

export const MATCH_RULES = Object.freeze({
  tickRate: 60,
  childMoveSpeed: 3.6,
  ghostMoveSpeed: 3.96,
  playerRadius: 0.45,
  mapCollisionRadius: 0.35,
  flashlightSecondsAtFullCharge: 8,
  flashlightLength: 7.5,
  flashlightConeDegrees: 44,
  flashlightDamagePerSecond: 12.5,
  beamDamageMultipliers: [1, 0.65, 0.45, 0.3] as const,
  ghostMaxHealth: 50,
  illuminatedGhostSpeedMultiplier: 0.8,
  ghostBurnDurationTicks: 90,
  matchDurationTicks: 18_000,
  captureAnimationTicks: 210,
  protectionTicks: 120,
  captureContactRange: 0.98,
  captureContactTicks: 18,
  capturesToWin: 3,
  headlampDetectionRange: 7.5,
  batterySpawnThreshold: 0.7,
  batteryDoubleSpawnThreshold: 0.5,
  batteryPickupRadius: 0.75,
  lightningMinimumIntervalTicks: 600,
  lightningMaximumIntervalTicks: 1_200,
  lightningRevealHoldTicks: 15,
  lightningPreflashMinimumTicks: 5,
  lightningPreflashMaximumTicks: 7,
  lightningGapMinimumTicks: 16,
  lightningGapMaximumTicks: 19,
  lightningMainMinimumTicks: 52,
  lightningMainMaximumTicks: 58,
  lightningThunderMinimumDelayTicks: 12,
  lightningThunderMaximumDelayTicks: 72,
});

export const DEFAULT_GAMEPLAY_TUNING: Readonly<GameplayTuning> = Object.freeze({
  childMoveSpeed: MATCH_RULES.childMoveSpeed,
  ghostMoveSpeed: MATCH_RULES.ghostMoveSpeed,
  headlampDetectionRange: MATCH_RULES.headlampDetectionRange,
  flashlightLength: MATCH_RULES.flashlightLength,
  flashlightConeDegrees: MATCH_RULES.flashlightConeDegrees,
  infiniteGhostHealth: false,
  infiniteFlashlightEnergy: false,
});

export function isCaptureTargetInContact(
  ghost: { position: Vec2 },
  target: { position: Vec2 },
): boolean {
  return distanceBetween(ghost, target) <= MATCH_RULES.captureContactRange;
}

export class MatchEngine {
  private tick = 0;
  private readonly players: PlayerCheckpoint[];
  private readonly dolls: DollCheckpoint[];
  private readonly commands = new Map<string, PlayerCommand>();
  private ghostHealth: number = MATCH_RULES.ghostMaxHealth;
  private ghostRevealed = false;
  private ghostBurnTicksRemaining = 0;
  private phase: MatchCheckpoint['phase'] = 'playing';
  private winner: MatchCheckpoint['winner'] = null;
  private remainingTicks: number = MATCH_RULES.matchDurationTicks;
  private captureCount = 0;
  private phaseTicksRemaining = 0;
  private capturedChildPlayerId: string | null = null;
  private captureContactChildPlayerId: string | null = null;
  private captureContactTicks = 0;
  private nextEventId = 1;
  private events: MatchEvent[] = [];
  private randomState: number;
  private lightningRandomState: number;
  private lightningPlayingTick = 0;
  private nextLightningPlayingTick: number;
  private lightningSerial = 0;
  private lightning: LightningStrike | null = null;
  private lightningReveal: LightningRevealCheckpoint | null = null;
  private batterySerial = 0;
  private readonly batteries: BatteryCheckpoint[] = [];
  private gameplayTuning: GameplayTuning;

  constructor(private readonly setup: MatchSetup) {
    validateSetup(setup);
    this.gameplayTuning = normalizeGameplayTuning(setup.gameplayTuning);
    this.randomState = setup.seed >>> 0;
    this.lightningRandomState = (setup.seed ^ 0xa511e9b3) >>> 0;
    this.nextLightningPlayingTick = this.nextLightningIntervalTicks();
    this.players = [
      {
        id: setup.ghostPlayerId,
        role: 'ghost',
        slot: null,
        position: { ...setup.map.ghostSpawn },
        facingRadians: 0,
        battery: null,
        headlamp: null,
        active: true,
      },
      ...setup.childPlayerIds.map((id, index): PlayerCheckpoint => ({
        id,
        role: 'child',
        slot: index,
        position: { ...setup.map.childSpawns[index] },
        facingRadians: 0,
        battery: 1,
        headlamp: 'off',
        active: true,
      })),
    ];
    this.dolls = setup.map.childSpawns
      .slice(setup.childPlayerIds.length)
      .map((position, index) => ({
        id: `doll-${setup.childPlayerIds.length + index + 1}`,
        slot: setup.childPlayerIds.length + index,
        position: { ...position },
        headlamp: 'off',
      }));
  }

  advance(commands: readonly PlayerCommand[] = [], ticks = 1): MatchAdvanceResult {
    if (!Number.isInteger(ticks) || ticks < 1) throw new RangeError('ticks must be a positive integer.');
    this.events = [];
    for (const command of commands) {
      const player = this.players.find((candidate) => candidate.id === command.playerId);
      if (!player) throw new Error(`Command references unknown player: ${command.playerId}`);
      if (
        !Number.isFinite(command.move.x) ||
        !Number.isFinite(command.move.z) ||
        !Number.isFinite(command.facingRadians)
      ) {
        throw new RangeError('Command movement and facing must be finite numbers.');
      }
      this.commands.set(command.playerId, {
        ...command,
        move: { ...command.move },
      });
    }
    for (let index = 0; index < ticks; index += 1) this.step();
    return { checkpoint: this.checkpoint(), events: [...this.events] };
  }

  setPlayerActive(playerId: string, active: boolean): void {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error(`Unknown player: ${playerId}`);
    if (player.role !== 'child') throw new Error('Only a child can become a sensing doll.');
    player.active = active;
    if (!active) this.commands.delete(playerId);
    if (!active && this.captureContactChildPlayerId === playerId) this.clearCaptureContact();
  }

  setGameplayTuning(tuning: Partial<GameplayTuning>): void {
    this.gameplayTuning = normalizeGameplayTuning({ ...this.gameplayTuning, ...tuning });
  }

  checkpoint(): MatchCheckpoint {
    this.updateHeadlamps();
    const batteries = this.batteries.map((battery) => ({
      ...battery,
      position: { ...battery.position },
    }));
    return {
      tick: this.tick,
      phase: this.phase,
      winner: this.winner,
      remainingTicks: this.remainingTicks,
      captureCount: this.captureCount,
      phaseTicksRemaining: this.phaseTicksRemaining,
      capturedChildPlayerId: this.capturedChildPlayerId,
      captureContactChildPlayerId: this.captureContactChildPlayerId,
      captureContactTicks: this.captureContactTicks,
      ghostHealth: this.ghostHealth,
      ghostRevealed: this.ghostRevealed,
      ghostBurnTicksRemaining: this.ghostBurnTicksRemaining,
      randomState: this.randomState,
      lightningRandomState: this.lightningRandomState,
      lightningPlayingTick: this.lightningPlayingTick,
      nextLightningPlayingTick: this.nextLightningPlayingTick,
      lightningSerial: this.lightningSerial,
      lightning: cloneLightning(this.lightning),
      lightningReveal: this.lightningReveal
        ? { ...this.lightningReveal, position: { ...this.lightningReveal.position } }
        : null,
      players: this.players.map((player) => ({
        ...player,
        position: { ...player.position },
      })),
      dolls: this.dolls.map((doll) => ({ ...doll, position: { ...doll.position } })),
      batteries,
      battery: batteries[0]
        ? { ...batteries[0], position: { ...batteries[0].position } }
        : null,
    };
  }

  private step(): void {
    if (this.phase === 'ended') return;
    if (this.phase === 'capture-animation') {
      this.updatePausedPhase();
      this.tick += 1;
      return;
    }
    if (this.phase === 'protection') {
      this.updateProtectionPhase();
      this.tick += 1;
      return;
    }

    this.updateLightningTimeline();
    this.lightningPlayingTick += 1;
    if (this.lightningPlayingTick >= this.nextLightningPlayingTick) this.startLightning();
    const illuminatedAtStart = this.findFlashlightHitters().length > 0;
    const burningAtStart = illuminatedAtStart || this.ghostBurnTicksRemaining > 0;
    this.movePlayers(true, burningAtStart);
    this.updateFlashlights();
    this.updateLightningReveal();
    this.updateBattery();
    this.remainingTicks = Math.max(0, this.remainingTicks - 1);
    if (this.ghostHealth <= 0 || this.remainingTicks === 0) {
      this.finishMatch('children');
      this.tick += 1;
      return;
    }
    this.updateCaptureContact();
    this.tick += 1;
  }

  private updatePausedPhase(): void {
    this.ghostRevealed = false;
    this.lightningReveal = null;
    this.updateLightningTimeline();
    this.phaseTicksRemaining = Math.max(0, this.phaseTicksRemaining - 1);
    if (this.phaseTicksRemaining > 0) return;

    if (this.captureCount >= MATCH_RULES.capturesToWin) {
      this.finishMatch('ghost');
      return;
    }

    this.resetPlayerPositions();
    this.capturedChildPlayerId = null;
    this.phase = 'protection';
    this.phaseTicksRemaining = MATCH_RULES.protectionTicks;
    this.emit({ type: 'round-reset' });
  }

  private updateProtectionPhase(): void {
    this.ghostRevealed = false;
    this.lightningReveal = null;
    this.updateLightningTimeline();
    this.movePlayers(false, false);
    this.phaseTicksRemaining = Math.max(0, this.phaseTicksRemaining - 1);
    if (this.phaseTicksRemaining > 0) return;
    this.phase = 'playing';
    this.emit({ type: 'protection-ended' });
  }

  private completeCapture(target: PlayerCheckpoint): void {
    this.clearCaptureContact();
    this.captureCount += 1;
    this.capturedChildPlayerId = target.id;
    this.emit({ type: 'child-captured', childPlayerId: target.id, captureCount: this.captureCount });
    this.phase = 'capture-animation';
    this.phaseTicksRemaining = MATCH_RULES.captureAnimationTicks;
    this.lightningReveal = null;
  }

  private findCaptureTarget(): PlayerCheckpoint | undefined {
    const ghost = this.players.find((player) => player.role === 'ghost');
    if (!ghost) return undefined;
    return this.players
      .filter((player) => player.role === 'child')
      .filter((player) => player.active)
      .filter((child) => isCaptureTargetInContact(ghost, child))
      .sort((left, right) => {
        const leftDistance = Math.hypot(
          left.position.x - ghost.position.x,
          left.position.z - ghost.position.z,
        );
        const rightDistance = Math.hypot(
          right.position.x - ghost.position.x,
          right.position.z - ghost.position.z,
        );
        return leftDistance - rightDistance || left.id.localeCompare(right.id);
      })[0];
  }

  private updateCaptureContact(): void {
    if (this.ghostBurnTicksRemaining > 0) {
      this.clearCaptureContact();
      return;
    }

    const target = this.findCaptureTarget();
    if (!target) {
      this.clearCaptureContact();
      return;
    }
    if (this.captureContactChildPlayerId !== target.id) {
      this.captureContactChildPlayerId = target.id;
      this.captureContactTicks = 0;
    }
    this.captureContactTicks += 1;
    if (this.captureContactTicks >= MATCH_RULES.captureContactTicks) this.completeCapture(target);
  }

  private clearCaptureContact(): void {
    this.captureContactChildPlayerId = null;
    this.captureContactTicks = 0;
  }

  private movePlayers(includeGhost: boolean, burningGhost: boolean): void {
    const secondsPerTick = 1 / MATCH_RULES.tickRate;
    for (const player of this.players) {
      if (!player.active || (!includeGhost && player.role === 'ghost')) continue;
      const command = this.commands.get(player.id);
      if (!command) continue;
      const magnitude = Math.hypot(command.move.x, command.move.z);
      if (player.role === 'child') {
        player.facingRadians = command.facingRadians;
      } else if (magnitude > 0) {
        player.facingRadians = Math.atan2(command.move.z, command.move.x);
      }
      if (magnitude === 0) continue;
      const speed = player.role === 'ghost'
        ? this.gameplayTuning.ghostMoveSpeed
          * (burningGhost ? MATCH_RULES.illuminatedGhostSpeedMultiplier : 1)
        : this.gameplayTuning.childMoveSpeed * childMovementMultiplier(command.move, player.facingRadians);
      const distance = speed * secondsPerTick;
      const xCandidate = {
        x: player.position.x + (command.move.x / magnitude) * distance,
        z: player.position.z,
      };
      if (this.isPositionOpen(player.id, xCandidate)) player.position.x = xCandidate.x;

      const zCandidate = {
        x: player.position.x,
        z: player.position.z + (command.move.z / magnitude) * distance,
      };
      if (this.isPositionOpen(player.id, zCandidate)) player.position.z = zCandidate.z;
    }
  }

  private resetPlayerPositions(): void {
    for (const player of this.players) {
      const spawn =
        player.role === 'ghost'
          ? this.setup.map.ghostSpawn
          : this.setup.map.childSpawns[this.setup.childPlayerIds.indexOf(player.id)];
      player.position = { ...spawn };
    }
  }

  private finishMatch(winner: 'children' | 'ghost'): void {
    this.clearCaptureContact();
    this.winner = winner;
    this.phase = 'ended';
    this.phaseTicksRemaining = 0;
    this.capturedChildPlayerId = null;
    this.lightningReveal = null;
    this.emit({ type: 'match-ended', winner });
  }

  private emit(event: MatchEventPayload): void {
    this.events.push({ id: this.nextEventId, tick: this.tick, ...event });
    this.nextEventId += 1;
  }

  private updateFlashlights(): void {
    const chargePerTick = 1 / (MATCH_RULES.flashlightSecondsAtFullCharge * MATCH_RULES.tickRate);
    const hitters: Array<{ player: PlayerCheckpoint; energyRatio: number }> = [];

    for (const player of this.players) {
      if (player.role !== 'child' || !player.active || player.battery === null) continue;
      const command = this.commands.get(player.id);
      if (
        !command?.action
        || (!this.gameplayTuning.infiniteFlashlightEnergy && player.battery <= 0)
      ) continue;

      const spentCharge = this.gameplayTuning.infiniteFlashlightEnergy
        ? chargePerTick
        : Math.min(player.battery, chargePerTick);
      if (!this.gameplayTuning.infiniteFlashlightEnergy) {
        player.battery = Math.max(0, player.battery - spentCharge);
      }
      if (this.flashlightHitsGhost(player)) {
        hitters.push({ player, energyRatio: spentCharge / chargePerTick });
      }
    }

    this.ghostRevealed = hitters.length > 0;
    this.ghostBurnTicksRemaining = hitters.length > 0
      ? MATCH_RULES.ghostBurnDurationTicks
      : Math.max(0, this.ghostBurnTicksRemaining - 1);
    let damage = 0;
    for (let index = 0; index < hitters.length; index += 1) {
      const multiplier = MATCH_RULES.beamDamageMultipliers[index] ?? 0;
      damage +=
        (MATCH_RULES.flashlightDamagePerSecond * multiplier * hitters[index].energyRatio) /
        MATCH_RULES.tickRate;
    }
    if (!this.gameplayTuning.infiniteGhostHealth) {
      const remainingHealth = Math.max(0, this.ghostHealth - damage);
      this.ghostHealth = remainingHealth < 1e-9 ? 0 : remainingHealth;
    }
  }

  private updateBattery(): void {
    for (let index = 0; index < this.batteries.length; index += 1) {
      const battery = this.batteries[index];
      const collector = this.players
        .filter(
          (player) =>
            player.role === 'child' &&
            player.active &&
            player.battery !== null &&
            player.battery < 1,
        )
        .filter(
          (player) =>
            Math.hypot(
              player.position.x - battery.position.x,
              player.position.z - battery.position.z,
            ) <= MATCH_RULES.batteryPickupRadius,
        )
        .sort((left, right) => left.id.localeCompare(right.id))[0];
      if (!collector) continue;

      collector.battery = 1;
      this.batteries.splice(index, 1);
      this.emit({ type: 'battery-collected', batteryId: battery.id, childPlayerId: collector.id });
      break;
    }

    const activeCharges = this.players
      .filter((player) => player.role === 'child' && player.active && player.battery !== null)
      .map((player) => player.battery as number);
    const lowestCharge = activeCharges.length > 0 ? Math.min(...activeCharges) : 1;
    const targetCount = lowestCharge < MATCH_RULES.batteryDoubleSpawnThreshold
      ? 2
      : lowestCharge < MATCH_RULES.batterySpawnThreshold
        ? 1
        : 0;
    const maximumCount = Math.min(targetCount, this.setup.map.batterySpawns.length);

    while (this.batteries.length < maximumCount) {
      const occupiedSpawns = new Set(this.batteries.map((battery) => battery.spawnIndex));
      const availableSpawns = this.setup.map.batterySpawns
        .map((_, index) => index)
        .filter((index) => !occupiedSpawns.has(index));
      if (availableSpawns.length === 0) break;

      const spawnIndex = availableSpawns[this.nextRandomInt(availableSpawns.length)];
      this.batterySerial += 1;
      const battery: BatteryCheckpoint = {
        id: `battery-${this.batterySerial}`,
        spawnIndex,
        position: { ...this.setup.map.batterySpawns[spawnIndex] },
      };
      this.batteries.push(battery);
      this.emit({
        type: 'battery-spawned',
        battery: { ...battery, position: { ...battery.position } },
      });
    }
  }

  private updateHeadlamps(): void {
    const ghost = this.players.find((player) => player.role === 'ghost');
    if (!ghost) return;
    for (const player of this.players) {
      player.headlamp = player.role === 'child'
        ? headlampForDistance(distanceBetween(player, ghost), this.gameplayTuning.headlampDetectionRange)
        : null;
    }
    for (const doll of this.dolls) {
      doll.headlamp = headlampForDistance(
        distanceBetween(doll, ghost),
        this.gameplayTuning.headlampDetectionRange,
      );
    }
  }

  private nextRandomInt(maximum: number): number {
    this.randomState = (this.randomState + 0x6d2b79f5) >>> 0;
    let value = this.randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const normalized = ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    return Math.floor(normalized * maximum);
  }

  private nextLightningRandomInt(maximum: number): number {
    this.lightningRandomState = (this.lightningRandomState + 0x6d2b79f5) >>> 0;
    let value = this.lightningRandomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const normalized = ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    return Math.floor(normalized * maximum);
  }

  private nextLightningIntervalTicks(): number {
    return randomIntegerInRange(
      MATCH_RULES.lightningMinimumIntervalTicks,
      MATCH_RULES.lightningMaximumIntervalTicks,
      (maximum) => this.nextLightningRandomInt(maximum),
    );
  }

  private startLightning(): void {
    const directions: readonly LightningDirection[] = ['north', 'east', 'south', 'west'];
    const direction = directions[this.nextLightningRandomInt(directions.length)];
    const preflashCount = 2 + this.nextLightningRandomInt(2);
    const pulses: LightningPulse[] = [];
    let pulseStartTick = this.tick;
    for (let index = 0; index < preflashCount; index += 1) {
      const durationTicks = randomIntegerInRange(
        MATCH_RULES.lightningPreflashMinimumTicks,
        MATCH_RULES.lightningPreflashMaximumTicks,
        (maximum) => this.nextLightningRandomInt(maximum),
      );
      pulses.push({ kind: 'preflash', startTick: pulseStartTick, durationTicks });
      pulseStartTick += durationTicks + randomIntegerInRange(
        MATCH_RULES.lightningGapMinimumTicks,
        MATCH_RULES.lightningGapMaximumTicks,
        (maximum) => this.nextLightningRandomInt(maximum),
      );
    }
    const mainDurationTicks = randomIntegerInRange(
      MATCH_RULES.lightningMainMinimumTicks,
      MATCH_RULES.lightningMainMaximumTicks,
      (maximum) => this.nextLightningRandomInt(maximum),
    );
    pulses.push({ kind: 'main', startTick: pulseStartTick, durationTicks: mainDurationTicks });
    const thunderDelayTicks = randomIntegerInRange(
      MATCH_RULES.lightningThunderMinimumDelayTicks,
      MATCH_RULES.lightningThunderMaximumDelayTicks,
      (maximum) => this.nextLightningRandomInt(maximum),
    );
    this.lightningSerial += 1;
    this.lightning = {
      id: this.lightningSerial,
      startTick: this.tick,
      direction,
      pulses,
      thunderTick: pulseStartTick + mainDurationTicks + thunderDelayTicks,
      thunderVariant: this.nextLightningRandomInt(3) as 0 | 1 | 2,
    };
    this.nextLightningPlayingTick = this.lightningPlayingTick + this.nextLightningIntervalTicks();
    this.emit({
      type: 'lightning-started',
      lightning: cloneLightning(this.lightning) as LightningStrike,
    });
  }

  private updateLightningTimeline(): void {
    if (this.lightning && this.tick > this.lightning.thunderTick) this.lightning = null;
  }

  private updateLightningReveal(): void {
    const lightning = this.lightning;
    const pulseActive = lightning?.pulses.some((pulse) =>
      this.tick >= pulse.startTick && this.tick < pulse.startTick + pulse.durationTicks,
    ) ?? false;
    const ghost = this.players.find((player) => player.role === 'ghost');
    if (
      lightning
      && pulseActive
      && ghost
      && isPositionLitByLightning(this.setup.map, ghost.position, lightning.direction)
    ) {
      this.lightningReveal = {
        position: { ...ghost.position },
        facingRadians: ghost.facingRadians,
        ticksRemaining: MATCH_RULES.lightningRevealHoldTicks,
      };
      return;
    }
    if (!this.lightningReveal) return;
    this.lightningReveal.ticksRemaining = Math.max(0, this.lightningReveal.ticksRemaining - 1);
    if (this.lightningReveal.ticksRemaining === 0) this.lightningReveal = null;
  }

  private findFlashlightHitters(): PlayerCheckpoint[] {
    return this.players.filter((player) => {
      if (
        player.role !== 'child' ||
        !player.active ||
        player.battery === null ||
        (!this.gameplayTuning.infiniteFlashlightEnergy && player.battery <= 0)
      ) return false;
      return Boolean(this.commands.get(player.id)?.action && this.flashlightHitsGhost(player));
    });
  }

  private flashlightHitsGhost(child: PlayerCheckpoint): boolean {
    const ghost = this.players.find((player) => player.role === 'ghost');
    if (!ghost) return false;
    const offsetX = ghost.position.x - child.position.x;
    const offsetZ = ghost.position.z - child.position.z;
    const distance = Math.hypot(offsetX, offsetZ);
    if (distance === 0 || distance > this.gameplayTuning.flashlightLength) return false;

    const forwardX = Math.cos(child.facingRadians);
    const forwardZ = Math.sin(child.facingRadians);
    const alignment = (forwardX * offsetX + forwardZ * offsetZ) / distance;
    const halfConeRadians = (this.gameplayTuning.flashlightConeDegrees * Math.PI) / 360;
    if (alignment < Math.cos(halfConeRadians)) return false;

    return !this.setup.map.walls.some((wall) =>
      segmentIntersectsRectangle(child.position, ghost.position, wall),
    );
  }

  private isPositionOpen(playerId: string, position: Vec2): boolean {
    if (!mapPositionIsOpen(
      this.setup.map,
      position,
      MATCH_RULES.playerRadius,
      MATCH_RULES.mapCollisionRadius,
    )) return false;

    const radius = MATCH_RULES.playerRadius;
    for (const other of this.players) {
      if (other.id === playerId || !other.active) continue;
      if (Math.hypot(position.x - other.position.x, position.z - other.position.z) < radius * 2) {
        return false;
      }
    }

    return true;
  }
}

export function isPositionLitByLightning(
  map: MatchMap,
  position: Vec2,
  direction: LightningDirection,
  sampleRadius = MATCH_RULES.playerRadius,
): boolean {
  const sampleOffsets = [-sampleRadius, 0, sampleRadius];
  let openSamples = 0;
  for (const offset of sampleOffsets) {
    const sample = direction === 'north' || direction === 'south'
      ? { x: position.x + offset, z: position.z }
      : { x: position.x, z: position.z + offset };
    const source = lightningRaySource(map, sample, direction);
    const blocked = map.walls
      .filter((wall) => !wall.id.startsWith('boundary:'))
      .some((wall) => segmentIntersectsRectangle(source, sample, wall));
    if (!blocked) openSamples += 1;
  }
  return openSamples >= 2;
}

function lightningRaySource(
  map: MatchMap,
  sample: Vec2,
  direction: LightningDirection,
): Vec2 {
  switch (direction) {
    case 'north':
      return { x: sample.x, z: map.bounds.maxZ + 1 };
    case 'east':
      return { x: map.bounds.maxX + 1, z: sample.z };
    case 'south':
      return { x: sample.x, z: map.bounds.minZ - 1 };
    case 'west':
      return { x: map.bounds.minX - 1, z: sample.z };
  }
}

function cloneLightning(lightning: LightningStrike | null): LightningStrike | null {
  return lightning
    ? { ...lightning, pulses: lightning.pulses.map((pulse) => ({ ...pulse })) }
    : null;
}

function randomIntegerInRange(
  minimum: number,
  maximum: number,
  nextRandomInt: (maximumExclusive: number) => number,
): number {
  return minimum + nextRandomInt(maximum - minimum + 1);
}

function validateSetup(setup: MatchSetup): void {
  if (setup.childPlayerIds.length < 1 || setup.childPlayerIds.length > 4) {
    throw new RangeError('A match requires one to four child players.');
  }
  const playerIds = [setup.ghostPlayerId, ...setup.childPlayerIds];
  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error('Ghost and child player IDs must be unique.');
  }
  if (playerIds.some((playerId) => playerId.trim().length === 0)) {
    throw new Error('Player IDs must not be empty.');
  }
  if (!Number.isFinite(setup.seed)) throw new RangeError('Match seed must be finite.');
  if (setup.map.childSpawns.length !== 4) throw new Error('A match map must define four child spawns.');
  if (setup.map.batterySpawns.length === 0) throw new Error('A match map must define battery spawns.');
}

function normalizeGameplayTuning(tuning: Partial<GameplayTuning> | undefined): GameplayTuning {
  return {
    childMoveSpeed: finiteTuningValue(
      tuning?.childMoveSpeed,
      DEFAULT_GAMEPLAY_TUNING.childMoveSpeed,
      1,
      8,
      'Movement speed',
    ),
    ghostMoveSpeed: finiteTuningValue(
      tuning?.ghostMoveSpeed,
      DEFAULT_GAMEPLAY_TUNING.ghostMoveSpeed,
      1,
      8,
      'Movement speed',
    ),
    headlampDetectionRange: finiteTuningValue(
      tuning?.headlampDetectionRange,
      DEFAULT_GAMEPLAY_TUNING.headlampDetectionRange,
      1,
      20,
      'Headlamp detection range',
    ),
    flashlightLength: finiteTuningValue(
      tuning?.flashlightLength,
      DEFAULT_GAMEPLAY_TUNING.flashlightLength,
      0.5,
      12,
      'Flashlight length',
    ),
    flashlightConeDegrees: finiteTuningValue(
      tuning?.flashlightConeDegrees,
      DEFAULT_GAMEPLAY_TUNING.flashlightConeDegrees,
      5,
      90,
      'Flashlight cone width',
    ),
    infiniteGhostHealth: booleanTuningValue(
      tuning?.infiniteGhostHealth,
      DEFAULT_GAMEPLAY_TUNING.infiniteGhostHealth,
      'Infinite ghost health',
    ),
    infiniteFlashlightEnergy: booleanTuningValue(
      tuning?.infiniteFlashlightEnergy,
      DEFAULT_GAMEPLAY_TUNING.infiniteFlashlightEnergy,
      'Infinite flashlight energy',
    ),
  };
}

function booleanTuningValue(
  value: boolean | undefined,
  fallback: boolean,
  label: string,
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean.`);
  return value;
}

function finiteTuningValue(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function distanceBetween(left: { position: Vec2 }, right: { position: Vec2 }): number {
  return Math.hypot(left.position.x - right.position.x, left.position.z - right.position.z);
}

function headlampForDistance(distance: number, detectionRange: number): HeadlampBand {
  if (distance <= detectionRange / 3) return 'solid';
  if (distance <= (detectionRange * 2) / 3) return 'fast';
  if (distance <= detectionRange) return 'slow';
  return 'off';
}

function segmentIntersectsRectangle(
  start: Vec2,
  end: Vec2,
  rectangle: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  let minimumTime = 0;
  let maximumTime = 1;
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;

  for (const [origin, delta, minimum, maximum] of [
    [start.x, deltaX, rectangle.minX, rectangle.maxX],
    [start.z, deltaZ, rectangle.minZ, rectangle.maxZ],
  ] as const) {
    if (Math.abs(delta) < 1e-12) {
      if (origin < minimum || origin > maximum) return false;
      continue;
    }
    const inverseDelta = 1 / delta;
    let nearTime = (minimum - origin) * inverseDelta;
    let farTime = (maximum - origin) * inverseDelta;
    if (nearTime > farTime) [nearTime, farTime] = [farTime, nearTime];
    minimumTime = Math.max(minimumTime, nearTime);
    maximumTime = Math.min(maximumTime, farTime);
    if (minimumTime > maximumTime) return false;
  }

  return maximumTime > 0 && minimumTime < 1;
}
