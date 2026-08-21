/// <reference lib="webworker" />

import { DEFAULT_HOUSE_MAP } from '../game/defaultHouse';
import {
  MatchEngine,
  type MatchEvent,
  type PlayerCommand,
} from '../game/MatchEngine';
import { projectViewerFrame } from '../game/ViewerProjection';
import {
  BUILD_VERSION,
  INPUT_STALE_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PROTOCOL_VERSION,
  parseClientInputFrame,
  type BasicActionResponse,
  type ClientInputFrame,
  type PlayerRole,
  type RoomActionResponse,
  type RoomErrorCode,
  type RoomState,
  type ViewerMatchEvent,
} from './protocol';
import type {
  HarmonyClientMessage,
  HarmonyServerMessage,
  HarmonyWorkerInput,
  HarmonyWorkerOutput,
} from './HarmonyLanProtocol';

const LOCAL_PEER_ID = 'local';
const TICK_RATE = 60;
const FRAME_INTERVAL_TICKS = 3;

interface PrototypePlayer {
  playerId: string;
  nickname: string;
  peerId: string;
  isHost: boolean;
  connected: boolean;
  role: PlayerRole;
  ready: boolean;
  lastAcceptedSeq: number;
  latestInput: ClientInputFrame | null;
  lastInputAtMs: number;
}

class HarmonyHostedRoomPrototype {
  private roomCode = '';
  private readonly players = new Map<string, PrototypePlayer>();
  private readonly peerPlayers = new Map<string, string>();
  private phase: RoomState['phase'] = 'lobby';
  private matchId: string | null = null;
  private round = 0;
  private engine: MatchEngine | null = null;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private lastLoopAtMs = 0;
  private accumulatedMs = 0;

  receive(message: HarmonyWorkerInput): void {
    switch (message.type) {
      case 'configure':
        this.close();
        this.roomCode = message.roomCode;
        break;
      case 'peer-message':
        this.receivePeerMessage(message.peerId, message.payload);
        break;
      case 'peer-disconnected':
        this.disconnectPeer(message.peerId);
        break;
      case 'close':
        this.close();
        break;
    }
  }

  private receivePeerMessage(peerId: string, payload: string): void {
    let message: HarmonyClientMessage;
    try {
      message = JSON.parse(payload) as HarmonyClientMessage;
    } catch {
      this.send(peerId, { type: 'room-error', message: '房间消息格式无效。' });
      return;
    }
    switch (message.type) {
      case 'create-room':
        this.respond(peerId, message.requestId, this.createRoom(peerId, message.nickname));
        break;
      case 'join-room':
        this.respond(peerId, message.requestId, this.joinRoom(peerId, message));
        break;
      case 'start-match':
        this.respond(peerId, message.requestId, this.startMatch(peerId));
        break;
      case 'set-ready':
        this.respond(peerId, message.requestId, this.setReady(peerId, message.ready));
        break;
      case 'input-frame':
        this.acceptInput(peerId, message.frame);
        break;
    }
  }

  private createRoom(peerId: string, nickname: string): RoomActionResponse {
    if (peerId !== LOCAL_PEER_ID || this.players.size > 0 || this.roomCode.length !== 6) {
      return this.error('BAD_REQUEST', '当前不能创建房间。');
    }
    return this.addPlayer(peerId, nickname, true);
  }

  private joinRoom(
    peerId: string,
    message: Extract<HarmonyClientMessage, { type: 'join-room' }>,
  ): RoomActionResponse {
    if (message.protocolVersion !== PROTOCOL_VERSION || message.buildVersion !== BUILD_VERSION) {
      return this.error('VERSION_MISMATCH', '客户端版本不匹配。');
    }
    if (message.roomCode !== this.roomCode) return this.error('ROOM_NOT_FOUND', '没有找到这个房间。');
    if (this.phase !== 'lobby') return this.error('ROOM_CLOSED', '对局已经开始。');
    if (this.players.size >= MAX_PLAYERS) return this.error('ROOM_FULL', '房间已经满员。');
    if (this.peerPlayers.has(peerId)) return this.error('BAD_REQUEST', '这个连接已经加入房间。');
    return this.addPlayer(peerId, message.nickname, false);
  }

  private addPlayer(peerId: string, nickname: string, isHost: boolean): RoomActionResponse {
    const normalizedNickname = nickname.trim().replace(/\s+/g, ' ').slice(0, 18);
    if (normalizedNickname.length < 1) return this.error('BAD_REQUEST', '临时昵称无效。');
    const playerId = randomId('player');
    const player: PrototypePlayer = {
      playerId,
      nickname: normalizedNickname,
      peerId,
      isHost,
      connected: true,
      role: null,
      ready: false,
      lastAcceptedSeq: -1,
      latestInput: null,
      lastInputAtMs: 0,
    };
    this.players.set(playerId, player);
    this.peerPlayers.set(peerId, playerId);
    this.broadcastRoomState();
    this.post({ type: 'player-count', count: this.players.size });
    return {
      ok: true,
      session: {
        roomCode: this.roomCode,
        playerId,
        rejoinToken: randomId('rejoin'),
        isHost,
      },
    };
  }

  private startMatch(peerId: string): BasicActionResponse {
    const requester = this.playerForPeer(peerId);
    if (!requester) return this.error('NOT_IN_ROOM', '尚未加入房间。');
    if (!requester.isHost) return this.error('NOT_HOST', '只有房主可以开始。');
    if (this.players.size < MIN_PLAYERS) return this.error('NOT_ENOUGH_PLAYERS', '至少需要两名玩家。');
    if (this.phase !== 'lobby') return this.error('ROOM_CLOSED', '当前不能开始新对局。');
    this.beginMatch();
    return { ok: true };
  }

  private setReady(peerId: string, ready: boolean): BasicActionResponse {
    const player = this.playerForPeer(peerId);
    if (!player) return this.error('NOT_IN_ROOM', '尚未加入房间。');
    if (this.phase !== 'ended') return this.error('ROOM_CLOSED', '只能在结算后准备下一局。');
    player.ready = ready;
    const connected = [...this.players.values()].filter((candidate) => candidate.connected);
    if (connected.length >= MIN_PLAYERS && connected.every((candidate) => candidate.ready)) {
      this.beginMatch();
    } else {
      this.broadcastRoomState();
    }
    return { ok: true };
  }

  private beginMatch(): void {
    const roster = [...this.players.values()].filter((player) => player.connected);
    const ghostIndex = Math.floor(Math.random() * roster.length);
    const ghost = roster[ghostIndex];
    const children = roster.filter((player) => player !== ghost);
    ghost.role = 'ghost';
    for (const child of children) child.role = 'child';
    this.round += 1;
    this.matchId = randomId('match');
    this.engine = new MatchEngine({
      seed: Math.floor(Math.random() * 0x7fff_ffff),
      map: DEFAULT_HOUSE_MAP,
      ghostPlayerId: ghost.playerId,
      childPlayerIds: children.map((child) => child.playerId),
    });
    for (const player of roster) {
      player.ready = false;
      player.lastAcceptedSeq = -1;
      player.latestInput = null;
      player.lastInputAtMs = 0;
    }
    this.phase = 'playing';
    this.broadcastRoomState();
    this.broadcastFrame();
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.lastLoopAtMs = performance.now();
    this.accumulatedMs = 0;
    this.tickHandle = setInterval(() => this.pump(), 1000 / (TICK_RATE * 2));
  }

  private acceptInput(peerId: string, rawFrame: ClientInputFrame): void {
    const player = this.playerForPeer(peerId);
    const frame = parseClientInputFrame(rawFrame);
    if (!player || !frame || !this.matchId || frame.matchId !== this.matchId || this.phase !== 'playing') return;
    if (frame.seq <= player.lastAcceptedSeq) return;
    player.lastAcceptedSeq = frame.seq;
    player.latestInput = frame;
    player.lastInputAtMs = Date.now();
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
  }

  private tick(): void {
    if (!this.engine || !this.matchId || this.phase !== 'playing') return;
    const now = Date.now();
    const commands: PlayerCommand[] = [...this.players.values()]
      .filter((player) => player.role !== null)
      .map((player) => {
        const fresh = player.connected && player.latestInput !== null
          && now - player.lastInputAtMs <= INPUT_STALE_MS;
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
        .filter((player) => player.role === 'child' && player.latestInput?.action)
        .map((player) => player.playerId),
    );
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      this.send(player.peerId, {
        type: 'match-frame',
        envelope: {
          protocolVersion: PROTOCOL_VERSION,
          matchId: this.matchId,
          ackSeq: player.lastAcceptedSeq,
          frame: projectViewerFrame(checkpoint, player.playerId, {
            activeFlashlightPlayerIds: activeFlashlights,
          }),
        },
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
        this.send(player.peerId, {
          type: 'match-events',
          envelope: { matchId: this.matchId, events: safeEvents },
        });
      }
    }
  }

  private broadcastRoomState(): void {
    const state: RoomState = {
      roomCode: this.roomCode,
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
      notice: null,
      debugGameplayTuning: null,
    };
    for (const player of this.players.values()) {
      if (player.connected) this.send(player.peerId, { type: 'room-state', state });
    }
  }

  private disconnectPeer(peerId: string): void {
    const player = this.playerForPeer(peerId);
    if (!player) return;
    this.peerPlayers.delete(peerId);
    if (this.phase === 'lobby') {
      this.players.delete(player.playerId);
    } else {
      player.connected = false;
      player.latestInput = null;
      if (player.role === 'child') this.engine?.setPlayerActive(player.playerId, false);
    }
    this.post({ type: 'player-count', count: this.players.size });
    this.broadcastRoomState();
  }

  private playerForPeer(peerId: string): PrototypePlayer | undefined {
    const playerId = this.peerPlayers.get(peerId);
    return playerId ? this.players.get(playerId) : undefined;
  }

  private respond(peerId: string, requestId: string, result: RoomActionResponse | BasicActionResponse): void {
    this.send(peerId, { type: 'response', requestId, result });
  }

  private send(peerId: string, message: HarmonyServerMessage): void {
    this.post({ type: 'send', peerId, payload: JSON.stringify(message) });
  }

  private post(message: HarmonyWorkerOutput): void {
    self.postMessage(message);
  }

  private error(code: RoomErrorCode, message: string): { ok: false; error: { code: RoomErrorCode; message: string } } {
    return { ok: false, error: { code, message } };
  }

  private close(): void {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    this.engine = null;
    this.players.clear();
    this.peerPlayers.clear();
    this.phase = 'lobby';
    this.matchId = null;
    this.round = 0;
  }
}

function randomId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

const room = new HarmonyHostedRoomPrototype();
self.onmessage = (event: MessageEvent<HarmonyWorkerInput>) => room.receive(event.data);

