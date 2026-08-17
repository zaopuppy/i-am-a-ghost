import { io, type Socket } from 'socket.io-client';
import {
  BUILD_VERSION,
  PROTOCOL_VERSION,
  type BasicActionResponse,
  type ClientInputFrame,
  type ClientToServerEvents,
  type MatchEventEnvelope,
  type MatchFrameEnvelope,
  type RoomActionResponse,
  type RoomSession,
  type RoomState,
  type ServerToClientEvents,
} from './protocol';

export type GameClientListener = () => void;

export class GameClient {
  readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  connected = false;
  session: RoomSession | null = null;
  roomState: RoomState | null = null;
  latestFrame: MatchFrameEnvelope | null = null;
  latestEvents: MatchEventEnvelope | null = null;
  errorMessage = '';
  private readonly listeners = new Set<GameClientListener>();
  private inputSequence = 0;
  private clientTick = 0;

  constructor() {
    this.socket = io({ transports: ['websocket'], reconnectionDelay: 500 });
    this.socket.on('connect', () => {
      this.connected = true;
      this.notify();
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
      this.notify();
    });
    this.socket.on('match-frame', (frame) => {
      if (frame.protocolVersion !== PROTOCOL_VERSION) return;
      this.latestFrame = frame;
      this.notify();
    });
    this.socket.on('match-events', (events) => {
      this.latestEvents = events;
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
    const response = await this.socket.emitWithAck('create-room', {
      protocolVersion: PROTOCOL_VERSION,
      buildVersion: BUILD_VERSION,
      nickname,
    });
    this.acceptRoomResponse(response);
    return response;
  }

  async joinRoom(roomCode: string, nickname: string): Promise<RoomActionResponse> {
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

  sendInput(input: Omit<ClientInputFrame, 'matchId' | 'seq' | 'clientTick'>): void {
    const matchId = this.roomState?.matchId;
    if (!this.connected || !matchId || this.roomState?.phase !== 'playing') return;
    this.inputSequence += 1;
    this.clientTick += 1;
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

  private acceptRoomResponse(response: RoomActionResponse): void {
    if (response.ok) {
      this.session = response.session;
      this.errorMessage = '';
    } else {
      this.errorMessage = response.error.message;
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
