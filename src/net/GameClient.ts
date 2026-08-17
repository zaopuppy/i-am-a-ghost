import { io, type Socket } from 'socket.io-client';
import {
  BUILD_VERSION,
  PROTOCOL_VERSION,
  type BasicActionResponse,
  type ClientInputFrame,
  type ClientToServerEvents,
  type MatchEventEnvelope,
  type MatchFrameEnvelope,
  type GameplayTuning,
  type RoomActionResponse,
  type RoomSession,
  type RoomState,
  type ServerToClientEvents,
} from './protocol';
import { EventLedger } from './EventLedger';

export type GameClientListener = () => void;

export interface NetworkStats {
  pendingInputs: number;
  lastAckLatencyMs: number | null;
  frameAgeMs: number | null;
  reconnecting: boolean;
}

const SESSION_STORAGE_KEY = 'i-am-a-ghost:room-session';

export class GameClient {
  readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  connected = false;
  session: RoomSession | null = null;
  roomState: RoomState | null = null;
  latestFrame: MatchFrameEnvelope | null = null;
  latestEvents: MatchEventEnvelope | null = null;
  errorMessage = '';
  private readonly listeners = new Set<GameClientListener>();
  private readonly eventLedger = new EventLedger();
  private readonly inputSentAt = new Map<number, number>();
  private inputSequence = 0;
  private clientTick = 0;
  private lastFrameReceivedAt = 0;
  private lastAckLatencyMs: number | null = null;
  private nickname = '';
  private reconnecting = false;

  constructor() {
    this.restoreStoredSession();
    this.socket = io({ transports: ['websocket'], reconnectionDelay: 500 });
    this.socket.on('connect', () => {
      this.connected = true;
      this.notify();
      if (this.session && this.nickname) void this.resumeStoredSession();
    });
    this.socket.on('disconnect', () => {
      this.connected = false;
      this.notify();
    });
    this.socket.on('connect_error', () => {
      this.connected = false;
      this.notify();
    });
    this.socket.on('room-state', (state) => {
      this.roomState = state;
      this.synchronizeSessionHost(state);
      this.notify();
    });
    this.socket.on('match-frame', (frame) => {
      if (frame.protocolVersion !== PROTOCOL_VERSION) return;
      this.latestFrame = frame;
      this.lastFrameReceivedAt = performance.now();
      const acknowledgedAt = this.inputSentAt.get(frame.ackSeq);
      if (acknowledgedAt !== undefined) {
        this.lastAckLatencyMs = performance.now() - acknowledgedAt;
      }
      for (const sequence of this.inputSentAt.keys()) {
        if (sequence <= frame.ackSeq) this.inputSentAt.delete(sequence);
      }
      this.notify();
    });
    this.socket.on('match-events', (events) => {
      const accepted = this.eventLedger.accept(events);
      if (accepted.length === 0) return;
      this.latestEvents = { ...events, events: accepted };
      this.notify();
    });
    this.socket.on('room-error', (error) => {
      this.errorMessage = error.message;
      this.notify();
    });
  }

  subscribe(listener: GameClientListener): () => void {
    this.listeners.add(listener);
    listener();
    return () => this.listeners.delete(listener);
  }

  async createRoom(nickname: string): Promise<RoomActionResponse> {
    this.nickname = nickname;
    const response = await this.socket.emitWithAck('create-room', {
      protocolVersion: PROTOCOL_VERSION,
      buildVersion: BUILD_VERSION,
      nickname,
    });
    this.acceptRoomResponse(response);
    return response;
  }

  async joinRoom(roomCode: string, nickname: string): Promise<RoomActionResponse> {
    this.nickname = nickname;
    const response = await this.socket.emitWithAck('join-room', {
      protocolVersion: PROTOCOL_VERSION,
      buildVersion: BUILD_VERSION,
      roomCode,
      nickname,
    });
    this.acceptRoomResponse(response);
    return response;
  }

  async startMatch(): Promise<BasicActionResponse> {
    const response = await this.socket.emitWithAck('start-match');
    if (!response.ok) this.errorMessage = response.error.message;
    this.notify();
    return response;
  }

  async setReady(ready: boolean): Promise<BasicActionResponse> {
    const response = await this.socket.emitWithAck('set-ready', ready);
    if (!response.ok) this.errorMessage = response.error.message;
    this.notify();
    return response;
  }

  async setDebugTuning(tuning: GameplayTuning): Promise<BasicActionResponse> {
    const response = await this.socket.emitWithAck('set-debug-tuning', tuning);
    if (!response.ok) this.errorMessage = response.error.message;
    this.notify();
    return response;
  }

  sendInput(input: Omit<ClientInputFrame, 'matchId' | 'seq' | 'clientTick'>): void {
    const matchId = this.roomState?.matchId;
    if (!this.connected || !matchId || this.roomState?.phase !== 'playing') return;
    this.inputSequence += 1;
    this.clientTick += 1;
    this.inputSentAt.set(this.inputSequence, performance.now());
    this.socket.emit('input-frame', {
      matchId,
      seq: this.inputSequence,
      clientTick: this.clientTick,
      ...input,
    });
  }

  dispose(): void {
    this.listeners.clear();
    this.socket.disconnect();
  }

  networkStats(): NetworkStats {
    return {
      pendingInputs: this.inputSentAt.size,
      lastAckLatencyMs: this.lastAckLatencyMs,
      frameAgeMs: this.lastFrameReceivedAt > 0 ? performance.now() - this.lastFrameReceivedAt : null,
      reconnecting: this.reconnecting,
    };
  }

  private acceptRoomResponse(response: RoomActionResponse): void {
    if (response.ok) {
      this.session = response.session;
      this.errorMessage = '';
      this.storeSession();
    } else {
      this.errorMessage = response.error.message;
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private async resumeStoredSession(): Promise<void> {
    if (!this.session || !this.nickname || this.reconnecting) return;
    this.reconnecting = true;
    this.notify();
    const response = await this.socket.emitWithAck('join-room', {
      protocolVersion: PROTOCOL_VERSION,
      buildVersion: BUILD_VERSION,
      roomCode: this.session.roomCode,
      nickname: this.nickname,
      playerId: this.session.playerId,
      rejoinToken: this.session.rejoinToken,
    });
    this.reconnecting = false;
    if (response.ok) {
      this.acceptRoomResponse(response);
    } else {
      this.errorMessage = response.error.message;
      this.session = null;
      this.roomState = null;
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      this.notify();
    }
  }

  private storeSession(): void {
    if (!this.session || !this.nickname) return;
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ session: this.session, nickname: this.nickname }),
    );
  }

  private synchronizeSessionHost(state: RoomState): void {
    if (!this.session) return;
    const ownPlayer = state.players.find((player) => player.playerId === this.session?.playerId);
    if (!ownPlayer || ownPlayer.isHost === this.session.isHost) return;
    this.session = { ...this.session, isHost: ownPlayer.isHost };
    this.storeSession();
  }

  private restoreStoredSession(): void {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as { session?: RoomSession; nickname?: string };
      if (!stored.session || typeof stored.nickname !== 'string') return;
      this.session = stored.session;
      this.nickname = stored.nickname;
    } catch {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }
}
