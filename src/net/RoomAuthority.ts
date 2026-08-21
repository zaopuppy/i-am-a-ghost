import type {
  GameplayTuning,
  MatchCheckpoint,
  PlayerCommand,
} from '../game/MatchEngine';
import {
  INPUT_STALE_MS,
  type ClientInputFrame,
  type PlayerRole,
} from './protocol';

export interface AuthorityPlayerInput {
  playerId: string;
  connected: boolean;
  role: PlayerRole;
  latestInput: ClientInputFrame | null;
  lastInputAtMs: number;
}

export function buildAuthorityCommands(
  players: Iterable<AuthorityPlayerInput>,
  nowMs: number,
): PlayerCommand[] {
  return [...players]
    .filter((player) => player.role !== null)
    .map((player) => {
      const fresh = inputIsFresh(player, nowMs);
      return {
        playerId: player.playerId,
        move: {
          x: fresh ? (player.latestInput?.moveX ?? 0) : 0,
          z: fresh ? (player.latestInput?.moveZ ?? 0) : 0,
        },
        facingRadians: player.latestInput?.facingRadians ?? 0,
        action: fresh ? (player.latestInput?.action ?? false) : false,
      };
    });
}

export function activeFlashlightPlayerIds(
  checkpoint: MatchCheckpoint,
  players: Iterable<AuthorityPlayerInput>,
  tuning: GameplayTuning,
  nowMs: number,
): Set<string> {
  const checkpointPlayers = new Map(checkpoint.players.map((player) => [player.id, player]));
  return new Set(
    [...players]
      .filter((player) => {
        if (player.role !== 'child' || !inputIsFresh(player, nowMs) || !player.latestInput?.action) {
          return false;
        }
        return tuning.infiniteFlashlightEnergy
          || (checkpointPlayers.get(player.playerId)?.battery ?? 0) > 0;
      })
      .map((player) => player.playerId),
  );
}

function inputIsFresh(player: AuthorityPlayerInput, nowMs: number): boolean {
  return player.connected
    && player.latestInput !== null
    && nowMs - player.lastInputAtMs <= INPUT_STALE_MS;
}
