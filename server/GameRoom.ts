import { randomInt, randomUUID } from 'node:crypto';
import { MatchEngine, type MatchEvent, type PlayerCommand } from '../src/game/MatchEngine';
import { DEFAULT_HOUSE_MAP } from '../src/game/defaultHouse';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  PROTOCOL_VERSION,
  type BasicActionResponse,
  type ClientInputFrame,
  type PlayerRole,
  type RoomActionResponse,
  type RoomErrorCode,
  type RoomState,
  type ViewerMatchEvent,
} from '../src/net/protocol';
import { projectViewerFrame } from './ViewerProjection';
import { chooseNextGhost } from './RoleRotation';
import type { GameServer, GameSocket } from './types';

const TICK_RATE = 60;
const FRAME_INTERVAL_TICKS = 3;

interface RoomPlayer {
  playerId: string;
  rejoinToken: string;
  nickname: string;
  socketId: string;
  isHost: boolean;
  connected: boolean;
  role: PlayerRole;
  lastAcceptedSeq: number;
  latestInput: ClientInputFrame | null;
  ready: boolean;
}

export class GameRoom {
  private readonly players = new Map<string, RoomPlayer>();
  private phase: RoomState['phase'] = 'lobby';
  private matchId: string | null = null;
  private round = 0;
  private engine: MatchEngine | null = null;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private lastOccupiedAt = Date.now();
  private lastGhostPlayerId: string | null = null;

  constructor(
    private readonly io: GameServer,
    readonly code: string,
  ) {}

  join(socket: GameSocket, nickname: string): RoomActionResponse {
    if (this.phase !== 'lobby') return this.error('ROOM_CLOSED', '对局已经开始。');
    if (this.players.size >= MAX_PLAYERS) return this.error('ROOM_FULL', '房间已经满员。');

    const playerId = randomUUID();
    const player: RoomPlayer = {
      playerId,
      rejoinToken: randomUUID(),
      nickname,
      socketId: socket.id,
      isHost: this.players.size === 0,
      connected: true,
      role: null,
      lastAcceptedSeq: -1,
      latestInput: null,
      ready: false,
    };
    this.players.set(playerId, player);
    socket.data.roomCode = this.code;
    socket.data.playerId = playerId;
    void socket.join(this.socketRoomName());
    this.lastOccupiedAt = Date.now();
    this.broadcastRoomState();
    return {
      ok: true,
      session: {
        roomCode: this.code,
        playerId,
        rejoinToken: player.rejoinToken,
        isHost: player.isHost,
      },
    };
  }

  start(socketId: string): BasicActionResponse {
    const requester = this.playerForSocket(socketId);
    if (!requester) return this.error('NOT_IN_ROOM', '尚未加入房间。');
    if (!requester.isHost) return this.error('NOT_HOST', '只有房主可以开始。');
    if (this.players.size < MIN_PLAYERS) {
      return this.error('NOT_ENOUGH_PLAYERS', '至少需要两名玩家。');
    }
    if (this.phase !== 'lobby') return this.error('ROOM_CLOSED', '当前不能开始新对局。');

    this.beginMatch();
    return { ok: true };
  }

  setReady(socketId: string, ready: boolean): BasicActionResponse {
    const player = this.playerForSocket(socketId);
    if (!player) return this.error('NOT_IN_ROOM', '尚未加入房间。');
    if (this.phase !== 'ended') return this.error('ROOM_CLOSED', '只能在结算后准备下一局。');
    player.ready = ready;
    const connectedPlayers = [...this.players.values()].filter((candidate) => candidate.connected);
    if (connectedPlayers.length >= MIN_PLAYERS && connectedPlayers.every((candidate) => candidate.ready)) {
      this.beginMatch();
    } else {
      this.broadcastRoomState();
    }
    return { ok: true };
  }

  private beginMatch(): void {
    const roster = [...this.players.values()].filter((player) => player.connected);
    const ghostId = chooseNextGhost(
      roster.map((player) => player.playerId),
      this.lastGhostPlayerId,
      randomInt(roster.length),
    );
    const ghost = roster.find((player) => player.playerId === ghostId);
    if (!ghost) throw new Error('Ghost rotation selected a player outside the room.');
    const children = roster.filter((player) => player.playerId !== ghostId);
    ghost.role = 'ghost';
    for (const child of children) child.role = 'child';
    this.lastGhostPlayerId = ghost.playerId;

    this.round += 1;
    this.matchId = randomUUID();
    this.engine = new MatchEngine({
      seed: randomInt(0, 0x7fff_ffff),
      map: DEFAULT_HOUSE_MAP,
      ghostPlayerId: ghost.playerId,
      childPlayerIds: children.map((child) => child.playerId),
    });
    for (const player of roster) {
      player.lastAcceptedSeq = -1;
      player.latestInput = null;
      player.ready = false;
    }
    this.phase = 'playing';
    this.broadcastRoomState();
    this.broadcastFrame();
    this.tickHandle = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  acceptInput(socketId: string, frame: ClientInputFrame): boolean {
    const player = this.playerForSocket(socketId);
    if (!player || !this.matchId || frame.matchId !== this.matchId || this.phase !== 'playing') {
      return false;
    }
    if (frame.seq <= player.lastAcceptedSeq) return false;
    player.lastAcceptedSeq = frame.seq;
    player.latestInput = { ...frame };
    return true;
  }

  leave(socket: GameSocket): boolean {
    const player = this.playerForSocket(socket.id);
    if (!player) return false;
    this.players.delete(player.playerId);
    socket.data.roomCode = undefined;
    socket.data.playerId = undefined;
    void socket.leave(this.socketRoomName());
    this.promoteHost();
    this.broadcastRoomState();
    return true;
  }

  disconnect(socketId: string): void {
    const player = this.playerForSocket(socketId);
    if (!player) return;
    if (this.phase === 'lobby') {
      this.players.delete(player.playerId);
      this.promoteHost();
    } else {
      player.connected = false;
      player.latestInput = null;
    }
    this.broadcastRoomState();
  }

  connectedPlayerCount(): number {
    return [...this.players.values()].filter((player) => player.connected).length;
  }

  isEmptyFor(milliseconds: number): boolean {
    if (this.connectedPlayerCount() > 0) {
      this.lastOccupiedAt = Date.now();
      return false;
    }
    return Date.now() - this.lastOccupiedAt >= milliseconds;
  }

  dispose(): void {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    this.engine = null;
  }

  state(): RoomState {
    return {
      roomCode: this.code,
      phase: this.phase,
      matchId: this.matchId,
      round: this.round,
      players: [...this.players.values()].map((player) => ({
        playerId: player.playerId,
        nickname: player.nickname,
        isHost: player.isHost,
        connected: player.connected,
        role: player.role,
        ready: player.ready,
      })),
      minimumPlayers: MIN_PLAYERS,
      maximumPlayers: MAX_PLAYERS,
    };
  }

  private tick(): void {
    if (!this.engine || !this.matchId || this.phase !== 'playing') return;
    const commands: PlayerCommand[] = [...this.players.values()]
      .filter((player) => player.role !== null)
      .map((player) => ({
        playerId: player.playerId,
        move: {
          x: player.connected ? (player.latestInput?.moveX ?? 0) : 0,
          z: player.connected ? (player.latestInput?.moveZ ?? 0) : 0,
        },
        facingRadians: player.latestInput?.facingRadians ?? 0,
        action: player.connected ? (player.latestInput?.action ?? false) : false,
      }));
    const result = this.engine.advance(commands);
    if (result.events.length > 0) this.broadcastEvents(result.events);
    if (result.checkpoint.tick % FRAME_INTERVAL_TICKS === 0 || result.checkpoint.phase === 'ended') {
      this.broadcastFrame();
    }
    if (result.checkpoint.phase === 'ended') {
      this.phase = 'ended';
      for (const player of this.players.values()) player.ready = false;
      if (this.tickHandle) clearInterval(this.tickHandle);
      this.tickHandle = null;
      this.broadcastRoomState();
    }
  }

  private broadcastFrame(): void {
    if (!this.engine || !this.matchId) return;
    const checkpoint = this.engine.checkpoint();
    const activeFlashlights = new Set(
      [...this.players.values()]
        .filter((player) => {
          if (player.role !== 'child' || !player.latestInput?.action) return false;
          const checkpointPlayer = checkpoint.players.find((candidate) => candidate.id === player.playerId);
          return (checkpointPlayer?.battery ?? 0) > 0;
        })
        .map((player) => player.playerId),
    );
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      this.io.to(player.socketId).emit('match-frame', {
        protocolVersion: PROTOCOL_VERSION,
        matchId: this.matchId,
        ackSeq: player.lastAcceptedSeq,
        frame: projectViewerFrame(checkpoint, player.playerId, {
          activeFlashlightPlayerIds: activeFlashlights,
        }),
      });
    }
  }

  private broadcastEvents(events: readonly MatchEvent[]): void {
    if (!this.matchId) return;
    const safeEvents = events.map((event): ViewerMatchEvent => {
      if (event.type !== 'battery-spawned') return { ...event };
      const { battery: _battery, ...safeEvent } = event;
      return safeEvent;
    });
    for (const player of this.players.values()) {
      if (player.connected) {
        this.io.to(player.socketId).emit('match-events', { matchId: this.matchId, events: safeEvents });
      }
    }
  }

  private broadcastRoomState(): void {
    this.io.to(this.socketRoomName()).emit('room-state', this.state());
  }

  private playerForSocket(socketId: string): RoomPlayer | undefined {
    return [...this.players.values()].find((player) => player.socketId === socketId);
  }

  private promoteHost(): void {
    if ([...this.players.values()].some((player) => player.isHost)) return;
    const nextHost = this.players.values().next().value as RoomPlayer | undefined;
    if (nextHost) nextHost.isHost = true;
  }

  private socketRoomName(): string {
    return `game:${this.code}`;
  }

  private error(code: RoomErrorCode, message: string): { ok: false; error: { code: RoomErrorCode; message: string } } {
    return { ok: false, error: { code, message } };
  }
}
