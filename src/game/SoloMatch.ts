import { GridNavigator } from './GridNavigator';
import { DEFAULT_GAMEPLAY_TUNING, MATCH_RULES, MatchEngine, type GameplayTuning, type MatchEvent, type MatchMap, type Vec2 } from './MatchEngine';
import { SoloBot } from './SoloBot';
import type { ViewerFrame } from './ViewerFrame';
import { projectViewerFrame } from './ViewerProjection';

export interface SoloOptions {
  role: 'ghost' | 'child';
  childCount: number;
  seed: number;
}

/** Local authority and fixed-step clock. No transport, storage, or rendering dependencies. */
export class SoloMatch {
  readonly viewerPlayerId: string;
  private readonly engine: MatchEngine;
  private readonly bots: SoloBot[];
  private readonly botIds: string[];
  private readonly flashlights = new Set<string>();
  private events: MatchEvent[] = [];
  private accumulator = 0;
  private isPaused = false;
  private previousFrame: ViewerFrame | null = null;
  private tuning: GameplayTuning;

  constructor(map: MatchMap, readonly options: Readonly<SoloOptions>, tuning: Partial<GameplayTuning> = {}) {
    this.tuning = { ...DEFAULT_GAMEPLAY_TUNING, ...tuning };
    if (!Number.isInteger(options.childCount) || options.childCount < 1 || options.childCount > 4) {
      throw new RangeError('Solo matches require one to four children.');
    }
    const childPlayerIds = Array.from({ length: options.childCount }, (_, index) => `solo-child-${index}`);
    this.viewerPlayerId = options.role === 'ghost' ? 'solo-ghost' : childPlayerIds[0];
    this.engine = new MatchEngine({ seed: options.seed, map, ghostPlayerId: 'solo-ghost', childPlayerIds, gameplayTuning: this.tuning });
    const navigator = new GridNavigator(map);
    this.botIds = ['solo-ghost', ...childPlayerIds].filter((id) => id !== this.viewerPlayerId);
    this.bots = this.botIds.map((id, index) => new SoloBot(id, map, navigator, index + Math.abs(options.seed % 31)));
  }

  get paused(): boolean { return this.isPaused; }

  setGameplayTuning(tuning: Partial<GameplayTuning>): void {
    Object.assign(this.tuning, tuning);
    this.engine.setGameplayTuning(tuning);
  }

  setPaused(paused: boolean): void {
    this.isPaused = paused;
  }

  update(deltaSeconds: number, movement: Vec2, facingRadians: number, actionHeld: boolean): ViewerFrame {
    if (this.isPaused || this.engine.checkpoint().phase === 'ended') return this.frame();
    this.accumulator += Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(0.1, deltaSeconds)) : 0;
    while (this.accumulator + 1e-9 >= 1 / MATCH_RULES.tickRate) {
      this.accumulator -= 1 / MATCH_RULES.tickRate;
      this.previousFrame = this.frame();
      const before = this.engine.checkpoint();
      const commands = this.bots.map((bot, index) => bot.command(projectViewerFrame(before, this.botIds[index], {
        activeFlashlightPlayerIds: this.flashlights,
      }), this.tuning));
      commands.push({ playerId: this.viewerPlayerId, move: movement, facingRadians, action: actionHeld });
      const result = this.engine.advance(commands);
      this.events.push(...result.events);
      this.flashlights.clear();
      if (result.checkpoint.phase === 'playing') {
        for (const command of commands) {
          const player = result.checkpoint.players.find((candidate) => candidate.id === command.playerId);
          if (command.action && player?.role === 'child' && (player.battery ?? 0) > 0) this.flashlights.add(player.id);
        }
      }
      if (result.checkpoint.phase === 'ended') {
        this.accumulator = 0;
        break;
      }
    }
    return this.frame();
  }

  frame(): ViewerFrame {
    return projectViewerFrame(this.engine.checkpoint(), this.viewerPlayerId, {
      activeFlashlightPlayerIds: this.flashlights,
    });
  }

  /** Render one tick behind authority so every display frame has continuous motion. */
  presentationFrame(): ViewerFrame {
    const current = this.frame();
    const previous = this.previousFrame;
    if (!previous || previous.phase !== current.phase || current.phase === 'ended'
      || previous.captureCount !== current.captureCount) return current;
    const alpha = Math.max(0, Math.min(1, this.accumulator * MATCH_RULES.tickRate));
    const interpolate = (
      actor: { position: Vec2; facingRadians: number },
      before: { position: Vec2; facingRadians: number },
    ): void => {
      actor.position = {
        x: before.position.x + (actor.position.x - before.position.x) * alpha,
        z: before.position.z + (actor.position.z - before.position.z) * alpha,
      };
      const turn = Math.atan2(Math.sin(actor.facingRadians - before.facingRadians),
        Math.cos(actor.facingRadians - before.facingRadians));
      actor.facingRadians = before.facingRadians + turn * alpha;
    };
    for (const child of current.children) {
      const before = previous.children.find((candidate) => candidate.playerId === child.playerId);
      if (before) interpolate(child, before);
    }
    // Only interpolate information visible in both projected frames.
    if (current.ghost && previous.ghost) interpolate(current.ghost, previous.ghost);
    return current;
  }

  drainEvents(): MatchEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }
}
