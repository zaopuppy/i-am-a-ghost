import { randomInt, randomUUID } from 'node:crypto';
import {
  DEFAULT_GAMEPLAY_TUNING,
  MatchEngine,
  type GameplayTuning,
  type MatchEvent,
  type PlayerCommand,
} from '../src/game/MatchEngine';
import { DEFAULT_HOUSE_MAP } from '../src/game/defaultHouse';
import {
  INPUT_STALE_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PROTOCOL_VERSION,
  RECONNECT_GRACE_MS,
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
  lastInputAtMs: number;
  disconnectDeadlineMs: number | null;
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
  private notice: RoomState['notice'] = null;
  private lastLoopAtMs = 0;
  private accumulatedMs = 0;
  private gameplayTuning: GameplayTuning = { ...DEFAULT_GAMEPLAY_TUNING };

  constructor(
    private readonly io: GameServer,
    readonly code: string,
    private readonly debugTuningEnabled = false,
  ) {}

  join(
    socket: GameSocket,
    nickname: string,
    rejoin?: { playerId: string; rejoinToken: string },
  ): RoomActionResponse {
    if (rejoin) {
      const restored = this.restore(socket, rejoin.playerId, rejoin.rejoinToken);
      if (restored) return restored;
    }
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
      lastInputAtMs: 0,
      disconnectDeadlineMs: null,
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

  setDebugTuning(socketId: string, tuning: GameplayTuning): BasicActionResponse {
    if (!this.debugTuningEnabled) return this.error('BAD_REQUEST', '调试参数仅在开发服务器中开放。');
    const requester = this.playerForSocket(socketId);
    if (!requester) return this.error('NOT_IN_ROOM', '尚未加入房间。');
    if (!requester.isHost) return this.error('NOT_HOST', '只有房主可以调整房间参数。');
    this.gameplayTuning = { ...tuning };
    this.engine?.setGameplayTuning(tuning);
    this.broadcastRoomState();
    this.broadcastFrame();
    return { ok: true };
  }

  private beginMatch(): void {
    for (const [playerId, player] of this.players) {
      if (!player.connected) this.players.delete(playerId);
    }
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
      gameplayTuning: this.gameplayTuning,
    });
    for (const player of roster) {
      player.lastAcceptedSeq = -1;
      player.latestInput = null;
      player.ready = false;
      player.lastInputAtMs = 0;
      player.disconnectDeadlineMs = null;
    }
    this.phase = 'playing';
    this.notice = null;
    this.broadcastRoomState();
    this.broadcastFrame();
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.lastLoopAtMs = performance.now();
    this.accumulatedMs = 0;
    this.tickHandle = setInterval(() => this.pump(), 1000 / (TICK_RATE * 2));
  }

  acceptInput(socketId: string, frame: ClientInputFrame): boolean {
    const player = this.playerForSocket(socketId);
    if (!player || !this.matchId || frame.matchId !== this.matchId || this.phase !== 'playing') {
      return false;
    }
    if (frame.seq <= player.lastAcceptedSeq) return false;
    player.lastAcceptedSeq = frame.seq;
    player.latestInput = { ...frame };
    player.lastInputAtMs = Date.now();
    return true;
  }

  leave(socket: GameSocket): boolean {
    const player = this.playerForSocket(socket.id);
    if (!player) return false;
    if (this.phase === 'playing') {
      this.disconnectDuringMatch(player, false);
    } else {
      this.players.delete(player.playerId);
    }
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
    } else if (this.phase === 'playing') {
      this.disconnectDuringMatch(player, true);
    } else {
      player.connected = false;
      player.latestInput = null;
      player.lastInputAtMs = 0;
      player.disconnectDeadlineMs = Date.now() + RECONNECT_GRACE_MS;
    }
    this.broadcastRoomState();
  }

  expireDisconnectedPlayers(nowMs = Date.now()): void {
    let changed = false;
    for (const [playerId, player] of this.players) {
      if (player.connected || player.disconnectDeadlineMs === null || player.disconnectDeadlineMs > nowMs) {
        continue;
      }
      player.disconnectDeadlineMs = null;
      player.rejoinToken = '';
      changed = true;
      if (this.phase !== 'playing') this.players.delete(playerId);
    }
    if (changed) {
      this.promoteHost();
      this.broadcastRoomState();
    }
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
      notice: this.notice,
      debugGameplayTuning: this.debugTuningEnabled ? { ...this.gameplayTuning } : null,
    };
  }

  private pump(): void {
    const now = performance.now();
    this.accumulatedMs += Math.min(100, Math.max(0, now - this.lastLoopAtMs));
    this.lastLoopAtMs = now;
    const stepMs = 1000 / TICK_RATE;
    let steps = 0;
    while (this.accumulatedMs >= stepMs && steps < 5) {
      this.tick();
      this.accumulatedMs -= stepMs;
      steps += 1;
    }
    if (steps === 5 && this.accumulatedMs >= stepMs) this.accumulatedMs = 0;
    this.expireDisconnectedPlayers();
  }

  private tick(): void {
    if (!this.engine || !this.matchId || this.phase !== 'playing') return;
    const now = Date.now();
    const commands: PlayerCommand[] = [...this.players.values()]
      .filter((player) => player.role !== null)
      .map((player) => {
        const inputIsFresh =
          player.connected && player.latestInput !== null && now - player.lastInputAtMs <= INPUT_STALE_MS;
        return {
          playerId: player.playerId,
          move: {
            x: inputIsFresh ? (player.latestInput?.moveX ?? 0) : 0,
            z: inputIsFresh ? (player.latestInput?.moveZ ?? 0) : 0,
          },
          facingRadians: player.latestInput?.facingRadians ?? 0,
          action: inputIsFresh ? (player.latestInput?.action ?? false) : false,
        };
      });
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

  private restore(
    socket: GameSocket,
    playerId: string,
    rejoinToken: string,
  ): RoomActionResponse | null {
    const player = this.players.get(playerId);
    if (
      !player ||
      player.connected ||
      !player.rejoinToken ||
      player.rejoinToken !== rejoinToken ||
      player.disconnectDeadlineMs === null ||
      player.disconnectDeadlineMs < Date.now()
    ) {
      return null;
    }
    player.socketId = socket.id;
    player.connected = true;
    player.disconnectDeadlineMs = null;
    player.latestInput = null;
    player.lastInputAtMs = 0;
    socket.data.roomCode = this.code;
    socket.data.playerId = player.playerId;
    void socket.join(this.socketRoomName());
    if (this.phase === 'playing' && player.role === 'child') {
      this.engine?.setPlayerActive(player.playerId, true);
    }
    this.lastOccupiedAt = Date.now();
    this.broadcastRoomState();
    this.broadcastFrame();
    return {
      ok: true,
      session: {
        roomCode: this.code,
        playerId: player.playerId,
        rejoinToken: player.rejoinToken,
        isHost: player.isHost,
      },
    };
  }

  private disconnectDuringMatch(player: RoomPlayer, allowRejoin: boolean): void {
    if (player.role === 'ghost') {
      this.abortMatchForGhostDisconnect(player.playerId);
      return;
    }
    player.connected = false;
    player.latestInput = null;
    player.lastInputAtMs = 0;
    player.disconnectDeadlineMs = allowRejoin ? Date.now() + RECONNECT_GRACE_MS : null;
    if (!allowRejoin) player.rejoinToken = '';
    this.engine?.setPlayerActive(player.playerId, false);
    this.broadcastFrame();
  }

  private abortMatchForGhostDisconnect(ghostPlayerId: string): void {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    this.engine = null;
    this.matchId = null;
    this.phase = 'lobby';
    this.notice = 'ghost-disconnected';
    this.players.delete(ghostPlayerId);
    for (const player of this.players.values()) {
      player.role = null;
      player.ready = false;
      player.latestInput = null;
      player.lastInputAtMs = 0;
      player.disconnectDeadlineMs = null;
    }
    this.promoteHost();
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
