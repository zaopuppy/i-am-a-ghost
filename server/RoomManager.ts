import { randomInt } from 'node:crypto';
import {
  BUILD_VERSION,
  PROTOCOL_VERSION,
  isCompatibleClient,
  parseClientInputFrame,
  type CreateRoomRequest,
  type JoinRoomRequest,
  type RoomActionResponse,
  type RoomError,
  type RoomErrorCode,
} from '../src/net/protocol';
import { GameRoom } from './GameRoom';
import type { GameServer, GameSocket } from './types';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EMPTY_ROOM_TTL_MS = 30_000;
const ROOM_SWEEP_MS = 10_000;

export class RoomManager {
  private readonly rooms = new Map<string, GameRoom>();
  private readonly sweepHandle: ReturnType<typeof setInterval>;

  constructor(private readonly io: GameServer) {
    this.io.on('connection', (socket) => this.installSocketHandlers(socket));
    this.sweepHandle = setInterval(() => this.sweep(), ROOM_SWEEP_MS);
  }

  getDiagnostics(): { rooms: number; connectedPlayers: number } {
    return {
      rooms: this.rooms.size,
      connectedPlayers: [...this.rooms.values()].reduce(
        (count, room) => count + room.connectedPlayerCount(),
        0,
      ),
    };
  }

  dispose(): void {
    clearInterval(this.sweepHandle);
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
  }

  private installSocketHandlers(socket: GameSocket): void {
    socket.on('create-room', (request, acknowledge) => acknowledge(this.createRoom(socket, request)));
    socket.on('join-room', (request, acknowledge) => acknowledge(this.joinRoom(socket, request)));
    socket.on('start-match', (acknowledge) => {
      const room = this.roomForSocket(socket);
      acknowledge(room ? room.start(socket.id) : this.error('NOT_IN_ROOM', '尚未加入房间。'));
    });
    socket.on('set-ready', (ready, acknowledge) => {
      const room = this.roomForSocket(socket);
      acknowledge(
        room ? room.setReady(socket.id, ready) : this.error('NOT_IN_ROOM', '尚未加入房间。'),
      );
    });
    socket.on('leave-room', (acknowledge) => {
      const room = this.roomForSocket(socket);
      acknowledge(room?.leave(socket) ? { ok: true } : this.error('NOT_IN_ROOM', '尚未加入房间。'));
    });
    socket.on('input-frame', (rawFrame) => {
      const frame = parseClientInputFrame(rawFrame);
      const room = this.roomForSocket(socket);
      if (frame && room) room.acceptInput(socket.id, frame);
    });
    socket.on('disconnect', () => this.roomForSocket(socket)?.disconnect(socket.id));
  }

  private createRoom(socket: GameSocket, request: CreateRoomRequest): RoomActionResponse {
    const error = this.validateIdentityRequest(request);
    if (error) return error;
    this.leaveCurrentRoom(socket);
    const code = this.generateRoomCode();
    const room = new GameRoom(this.io, code);
    this.rooms.set(code, room);
    return room.join(socket, normalizeNickname(request.nickname));
  }

  private joinRoom(socket: GameSocket, request: JoinRoomRequest): RoomActionResponse {
    const error = this.validateIdentityRequest(request);
    if (error) return error;
    const code = normalizeRoomCode(request.roomCode);
    const room = this.rooms.get(code);
    if (!room) return this.error('ROOM_NOT_FOUND', '没有找到这个房间。');
    this.leaveCurrentRoom(socket);
    const rejoin = typeof request.playerId === 'string' && typeof request.rejoinToken === 'string'
      ? { playerId: request.playerId, rejoinToken: request.rejoinToken }
      : undefined;
    return room.join(socket, normalizeNickname(request.nickname), rejoin);
  }

  private validateIdentityRequest(request: Partial<CreateRoomRequest> | undefined): { ok: false; error: RoomError } | null {
    if (!isCompatibleClient(request?.protocolVersion, request?.buildVersion)) {
      return this.error(
        'VERSION_MISMATCH',
        `客户端版本不匹配，需要协议 ${PROTOCOL_VERSION} / 构建 ${BUILD_VERSION}。`,
      );
    }
    if (typeof request?.nickname !== 'string' || normalizeNickname(request.nickname).length < 1) {
      return this.error('BAD_REQUEST', '临时昵称无效。');
    }
    return null;
  }

  private leaveCurrentRoom(socket: GameSocket): void {
    const code = socket.data.roomCode;
    if (!code) return;
    this.rooms.get(code)?.leave(socket);
  }

  private roomForSocket(socket: GameSocket): GameRoom | undefined {
    return socket.data.roomCode ? this.rooms.get(socket.data.roomCode) : undefined;
  }

  private generateRoomCode(): string {
    for (;;) {
      let code = '';
      for (let index = 0; index < 6; index += 1) {
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
  }

  private sweep(): void {
    for (const [code, room] of this.rooms) {
      room.expireDisconnectedPlayers();
      if (!room.isEmptyFor(EMPTY_ROOM_TTL_MS)) continue;
      room.dispose();
      this.rooms.delete(code);
    }
  }

  private error(code: RoomErrorCode, message: string): { ok: false; error: RoomError } {
    return { ok: false, error: { code, message } };
  }
}

function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function normalizeNickname(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 18);
}
