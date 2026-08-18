import type { GameplayTuning, MatchEvent } from '../game/MatchEngine';
import type { ViewerFrame } from '../game/ViewerFrame';

export type { GameplayTuning } from '../game/MatchEngine';

export const PROTOCOL_VERSION = 3;
export const BUILD_VERSION = '0.6.0-burning-tuning';
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
export const INPUT_STALE_MS = 250;
export const RECONNECT_GRACE_MS = 30_000;

export type RoomPhase = 'lobby' | 'playing' | 'ended';
export type PlayerRole = 'ghost' | 'child' | null;

export interface RoomPlayerSummary {
  playerId: string;
  nickname: string;
  isHost: boolean;
  connected: boolean;
  role: PlayerRole;
  ready: boolean;
}

export interface RoomState {
  roomCode: string;
  phase: RoomPhase;
  matchId: string | null;
  round: number;
  players: RoomPlayerSummary[];
  minimumPlayers: typeof MIN_PLAYERS;
  maximumPlayers: typeof MAX_PLAYERS;
  notice: 'ghost-disconnected' | null;
  debugGameplayTuning: GameplayTuning | null;
}

export interface RoomSession {
  roomCode: string;
  playerId: string;
  rejoinToken: string;
  isHost: boolean;
}

export interface CreateRoomRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  buildVersion: typeof BUILD_VERSION;
  nickname: string;
}

export interface JoinRoomRequest extends CreateRoomRequest {
  roomCode: string;
  playerId?: string;
  rejoinToken?: string;
}

export interface ClientInputFrame {
  matchId: string;
  seq: number;
  clientTick: number;
  moveX: number;
  moveZ: number;
  facingRadians: number;
  action: boolean;
}

export interface MatchFrameEnvelope {
  protocolVersion: typeof PROTOCOL_VERSION;
  matchId: string;
  ackSeq: number;
  frame: ViewerFrame;
}

type OmitDistributively<T, Key extends PropertyKey> = T extends unknown ? Omit<T, Key> : never;
export type ViewerMatchEvent = OmitDistributively<MatchEvent, 'battery'>;

export interface MatchEventEnvelope {
  matchId: string;
  events: ViewerMatchEvent[];
}

export type RoomErrorCode =
  | 'BAD_REQUEST'
  | 'VERSION_MISMATCH'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_CLOSED'
  | 'NOT_HOST'
  | 'NOT_IN_ROOM'
  | 'NOT_ENOUGH_PLAYERS';

export interface RoomError {
  code: RoomErrorCode;
  message: string;
}

export type RoomActionResponse =
  | { ok: true; session: RoomSession }
  | { ok: false; error: RoomError };

export type BasicActionResponse = { ok: true } | { ok: false; error: RoomError };

type Acknowledge<T> = (response: T) => void;

export interface ClientToServerEvents {
  'create-room': (request: CreateRoomRequest, acknowledge: Acknowledge<RoomActionResponse>) => void;
  'join-room': (request: JoinRoomRequest, acknowledge: Acknowledge<RoomActionResponse>) => void;
  'start-match': (acknowledge: Acknowledge<BasicActionResponse>) => void;
  'set-ready': (ready: boolean, acknowledge: Acknowledge<BasicActionResponse>) => void;
  'leave-room': (acknowledge: Acknowledge<BasicActionResponse>) => void;
  'set-debug-tuning': (
    tuning: GameplayTuning,
    acknowledge: Acknowledge<BasicActionResponse>,
  ) => void;
  'input-frame': (frame: ClientInputFrame) => void;
}

export interface ServerToClientEvents {
  'room-state': (state: RoomState) => void;
  'match-frame': (envelope: MatchFrameEnvelope) => void;
  'match-events': (envelope: MatchEventEnvelope) => void;
  'room-error': (error: RoomError) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  roomCode?: string;
  playerId?: string;
}

export function isCompatibleClient(protocolVersion: unknown, buildVersion: unknown): boolean {
  return protocolVersion === PROTOCOL_VERSION && buildVersion === BUILD_VERSION;
}

export function parseClientInputFrame(value: unknown): ClientInputFrame | null {
  if (!value || typeof value !== 'object') return null;
  const frame = value as Partial<ClientInputFrame>;
  if (
    typeof frame.matchId !== 'string' ||
    frame.matchId.length < 1 ||
    !Number.isSafeInteger(frame.seq) ||
    (frame.seq ?? -1) < 0 ||
    !Number.isSafeInteger(frame.clientTick) ||
    (frame.clientTick ?? -1) < 0 ||
    !Number.isFinite(frame.moveX) ||
    !Number.isFinite(frame.moveZ) ||
    Math.abs(frame.moveX ?? 2) > 1 ||
    Math.abs(frame.moveZ ?? 2) > 1 ||
    !Number.isFinite(frame.facingRadians) ||
    typeof frame.action !== 'boolean'
  ) {
    return null;
  }
  return frame as ClientInputFrame;
}

export function parseGameplayTuning(value: unknown): GameplayTuning | null {
  if (!value || typeof value !== 'object') return null;
  const tuning = value as Partial<GameplayTuning>;
  if (
    !Number.isFinite(tuning.childMoveSpeed)
    || !Number.isFinite(tuning.ghostMoveSpeed)
    || !Number.isFinite(tuning.headlampDetectionRange)
    || !Number.isFinite(tuning.flashlightLength)
    || !Number.isFinite(tuning.flashlightConeDegrees)
    || typeof tuning.infiniteGhostHealth !== 'boolean'
    || typeof tuning.infiniteFlashlightEnergy !== 'boolean'
    || (tuning.childMoveSpeed ?? 0) < 1
    || (tuning.childMoveSpeed ?? 9) > 8
    || (tuning.ghostMoveSpeed ?? 0) < 1
    || (tuning.ghostMoveSpeed ?? 9) > 8
    || (tuning.headlampDetectionRange ?? 0) < 1
    || (tuning.headlampDetectionRange ?? 21) > 20
    || (tuning.flashlightLength ?? 0) < 0.5
    || (tuning.flashlightLength ?? 13) > 12
    || (tuning.flashlightConeDegrees ?? 0) < 5
    || (tuning.flashlightConeDegrees ?? 91) > 90
  ) return null;
  return {
    childMoveSpeed: tuning.childMoveSpeed as number,
    ghostMoveSpeed: tuning.ghostMoveSpeed as number,
    headlampDetectionRange: tuning.headlampDetectionRange as number,
    flashlightLength: tuning.flashlightLength as number,
    flashlightConeDegrees: tuning.flashlightConeDegrees as number,
    infiniteGhostHealth: tuning.infiniteGhostHealth as boolean,
    infiniteFlashlightEnergy: tuning.infiniteFlashlightEnergy as boolean,
  };
}
