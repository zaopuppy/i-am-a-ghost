import {
  DEFAULT_GAMEPLAY_TUNING,
  MATCH_RULES,
  MatchEngine,
  type GameplayTuning,
  type MatchMap,
  type PlayerCommand,
  type Vec2,
} from './MatchEngine';
import type { ViewerFrame } from './ViewerFrame';
import { projectViewerFrame } from './ViewerProjection';

export const SCENE_PLAYTEST_QUERY_PARAM = 'scenePlaytest';
export type ScenePlaytestRole = 'child' | 'ghost';

const GHOST_PLAYER_ID = 'scene-playtest-ghost';
const CHILD_PLAYER_ID = 'scene-playtest-child';
const FIXED_STEP_SECONDS = 1 / MATCH_RULES.tickRate;
const MAX_FRAME_DELTA_SECONDS = 0.1;
const IDLE_MOVEMENT: Vec2 = Object.freeze({ x: 0, z: 0 });

export function parseScenePlaytestRole(value: string | null): ScenePlaytestRole | null {
  return value === 'child' || value === 'ghost' ? value : null;
}

/** Runs the authoritative rules locally so an editor draft can be tested without a room server. */
export class ScenePlaytest {
  readonly viewerPlayerId: string;
  private engine: MatchEngine;
  private accumulatorSeconds = 0;
  private flashlightHeld = false;
  private readonly activeFlashlightPlayerIds = new Set<string>();

  constructor(
    private readonly map: MatchMap,
    readonly role: ScenePlaytestRole,
    private readonly tuning: Partial<GameplayTuning> = DEFAULT_GAMEPLAY_TUNING,
  ) {
    this.viewerPlayerId = role === 'ghost' ? GHOST_PLAYER_ID : CHILD_PLAYER_ID;
    this.engine = this.createEngine();
  }

  update(
    deltaSeconds: number,
    movement: Vec2,
    facingRadians: number,
    actionHeld: boolean,
  ): ViewerFrame {
    this.flashlightHeld = this.role === 'child' && actionHeld;
    this.accumulatorSeconds += Math.min(
      MAX_FRAME_DELTA_SECONDS,
      Math.max(0, deltaSeconds),
    );
    const ticks = Math.floor(this.accumulatorSeconds / FIXED_STEP_SECONDS);
    if (ticks > 0) {
      this.accumulatorSeconds -= ticks * FIXED_STEP_SECONDS;
      this.engine.advance(this.commands(movement, facingRadians), ticks);
    }
    return this.frame();
  }

  frame(): ViewerFrame {
    const checkpoint = this.engine.checkpoint();
    const viewer = checkpoint.players.find((player) => player.id === this.viewerPlayerId);
    const flashlightActive = this.flashlightHeld
      && viewer?.role === 'child'
      && (viewer.battery ?? 0) > 0
      && checkpoint.phase === 'playing';
    this.activeFlashlightPlayerIds.clear();
    if (flashlightActive) this.activeFlashlightPlayerIds.add(this.viewerPlayerId);
    return projectViewerFrame(checkpoint, this.viewerPlayerId, {
      activeFlashlightPlayerIds: this.activeFlashlightPlayerIds,
    });
  }

  reset(): void {
    this.engine = this.createEngine();
    this.accumulatorSeconds = 0;
    this.flashlightHeld = false;
  }

  private createEngine(): MatchEngine {
    return new MatchEngine({
      seed: 71,
      map: this.map,
      ghostPlayerId: GHOST_PLAYER_ID,
      childPlayerIds: [CHILD_PLAYER_ID],
      gameplayTuning: this.tuning,
    });
  }

  private commands(movement: Vec2, facingRadians: number): PlayerCommand[] {
    return [
      {
        playerId: GHOST_PLAYER_ID,
        move: this.role === 'ghost' ? movement : IDLE_MOVEMENT,
        facingRadians,
        action: false,
      },
      {
        playerId: CHILD_PLAYER_ID,
        move: this.role === 'child' ? movement : IDLE_MOVEMENT,
        facingRadians,
        action: this.role === 'child' && this.flashlightHeld,
      },
    ];
  }
}
