import type { MatchEvent } from '../game/MatchEngine';
import type { ViewerFrame } from '../game/ViewerFrame';

export const PROTOCOL_VERSION = 1;
export const BUILD_VERSION = '0.2.0-m2-authoritative-room';
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;

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

export type ViewerMatchEvent = Omit<MatchEvent, 'battery'>;

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
