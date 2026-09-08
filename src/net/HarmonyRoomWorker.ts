/// <reference lib="webworker" />

import { DEFAULT_HOUSE_MAP } from '../game/defaultHouse';
import {
  DEFAULT_GAMEPLAY_TUNING,
  MatchEngine,
  type GameplayTuning,
  type MatchEvent,
} from '../game/MatchEngine';
import { projectViewerFrame } from '../game/ViewerProjection';
import {
  activeFlashlightPlayerIds,
  buildAuthorityCommands,
} from './RoomAuthority';
import {
  BUILD_VERSION,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PROTOCOL_VERSION,
  RECONNECT_GRACE_MS,
  parseClientInputFrame,
  parseHarmonyClientMessage,
  type BasicActionResponse,
  type ClientInputFrame,
  type HarmonyClientMessage,
  type HarmonyServerMessage,
  type HarmonyWorkerInput,
  type HarmonyWorkerOutput,
  type PlayerRole,
  type RoomActionResponse,
  type RoomErrorCode,
  type RoomState,
  type ViewerMatchEvent,
} from './protocol';

const LOCAL_PEER_ID = 'local';
const TICK_RATE = 60;
const FRAME_INTERVAL_TICKS = 3;
const MIN_INPUT_INTERVAL_MS = 8;
const MAX_CACHED_RESPONSES = 512;

interface PrototypePlayer {
  playerId: string;
  rejoinToken: string;
  nickname: string;
  peerId: string;
  isHost: boolean;
  connected: boolean;
  selectedRole: PlayerRole;
  role: PlayerRole;
  ready: boolean;
  assetsReady: boolean;
  lastAcceptedSeq: number;
  latestInput: ClientInputFrame | null;
  lastInputAtMs: number;
  lastInputMessageAtMs: number;
  disconnectDeadlineMs: number | null;
}

class HarmonyHostedRoomPrototype {
  private roomCode = '';
  private readonly players = new Map<string, PrototypePlayer>();
  private readonly peerPlayers = new Map<string, string>();
  private phase: RoomState['phase'] = 'lobby';
  private matchId: string | null = null;
  private round = 0;
  private notice: RoomState['notice'] = null;
  private engine: MatchEngine | null = null;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private lastLoopAtMs = 0;
  private accumulatedMs = 0;
  private expirationHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly gameplayTuning: GameplayTuning = { ...DEFAULT_GAMEPLAY_TUNING };
  private readonly responseCache = new Map<string, Extract<HarmonyServerMessage, { type: 'response' }>>();
  private readonly responseOrder: string[] = [];

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
    let rawMessage: unknown;
    try {
      rawMessage = JSON.parse(payload) as unknown;
    } catch {
      this.send(peerId, { type: 'room-error', message: '房间消息格式无效。' });
      return;
    }
    const message = parseHarmonyClientMessage(rawMessage);
    if (message === null) {
      this.send(peerId, { type: 'room-error', message: '房间消息字段无效。' });
      return;
    }
    switch (message.type) {
      case 'create-room':
        this.handleRequest(peerId, message.requestId, () => this.createRoom(peerId, message.nickname));
        break;
      case 'join-room':
        this.handleRequest(peerId, message.requestId, () => this.joinRoom(peerId, message));
        break;
      case 'start-match':
        this.handleRequest(peerId, message.requestId, () => this.startMatch(peerId));
        break;
      case 'select-role':
        this.handleRequest(peerId, message.requestId, () => this.selectRole(peerId, message.role));
        break;
      case 'set-ready':
        this.handleRequest(peerId, message.requestId, () => this.setReady(peerId, message.ready));
        break;
      case 'set-assets-ready':
        this.handleRequest(peerId, message.requestId, () => this.setAssetsReady(peerId, message.ready));
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
    if (message.playerId && message.rejoinToken) {
      const restored = this.restore(peerId, message.playerId, message.rejoinToken);
      if (restored) return restored;
    }
    if (this.phase !== 'lobby') return this.error('ROOM_CLOSED', '对局已经开始。');
    if (this.players.size >= MAX_PLAYERS) return this.error('ROOM_FULL', '房间已经满员。');
    if (this.peerPlayers.has(peerId)) return this.error('BAD_REQUEST', '这个连接已经加入房间。');
    return this.addPlayer(peerId, message.nickname, false);
  }

  private addPlayer(peerId: string, nickname: string, isHost: boolean): RoomActionResponse {
    const normalizedNickname = nickname.trim().replace(/\s+/g, ' ').slice(0, 18);
    if (normalizedNickname.length < 1) return this.error('BAD_REQUEST', '临时昵称无效。');
    const playerId = randomId('player');
    const rejoinToken = randomId('rejoin');
    const player: PrototypePlayer = {
      playerId,
      rejoinToken,
      nickname: normalizedNickname,
      peerId,
      isHost,
      connected: true,
      selectedRole: null,
      role: null,
      ready: false,
      assetsReady: false,
      lastAcceptedSeq: -1,
      latestInput: null,
      lastInputAtMs: 0,
      lastInputMessageAtMs: 0,
      disconnectDeadlineMs: null,
    };
    this.players.set(playerId, player);
    this.peerPlayers.set(peerId, playerId);
    this.broadcastRoomState();
    this.postPlayerCount();
    return {
      ok: true,
      session: {
        roomCode: this.roomCode,
        playerId,
        rejoinToken,
        isHost,
      },
    };
  }

  private startMatch(peerId: string): BasicActionResponse {
    const requester = this.playerForPeer(peerId);
    if (!requester) return this.error('NOT_IN_ROOM', '尚未加入房间。');
    if (!requester.isHost) return this.error('NOT_HOST', '只有房主可以开始。');
    if (this.phase !== 'lobby') return this.error('ROOM_CLOSED', '当前不能开始新对局。');
    const selectionError = this.validateConnectedSelection();
    if (selectionError) return selectionError;
    this.beginLoading();
    return { ok: true };
  }

  private selectRole(peerId: string, role: Exclude<PlayerRole, null>): BasicActionResponse {
    const player = this.playerForPeer(peerId);
    if (!player) return this.error('NOT_IN_ROOM', '尚未加入房间。');
    if (this.phase !== 'lobby' && this.phase !== 'ended') {
      return this.error('ROOM_CLOSED', '只能在大厅或结算后选择阵营。');
    }
    if (
      role === 'ghost'
      && [...this.players.values()].some((candidate) => (
        candidate.connected
        && candidate.playerId !== player.playerId
        && candidate.selectedRole === 'ghost'
      ))
    ) {
      return this.error('GHOST_TAKEN', '鬼阵营已经被其他玩家选择。');
    }
    if (player.selectedRole !== role) {
      player.selectedRole = role;
      player.ready = false;
    }
    this.broadcastRoomState();
    return { ok: true };
  }

  private setReady(peerId: string, ready: boolean): BasicActionResponse {
    const player = this.playerForPeer(peerId);
    if (!player) return this.error('NOT_IN_ROOM', '尚未加入房间。');
    if (this.phase !== 'ended') return this.error('ROOM_CLOSED', '只能在结算后准备下一局。');
    if (ready && player.selectedRole === null) {
      return this.error('ROLE_SELECTION_REQUIRED', '请先选择鬼或小孩阵营。');
    }
    player.ready = ready;
    const connected = [...this.players.values()].filter((candidate) => candidate.connected);
    if (connected.length >= MIN_PLAYERS && connected.every((candidate) => candidate.ready)) {
      const selectionError = this.validateConnectedSelection();
      if (selectionError) {
        this.broadcastRoomState();
        return selectionError;
      }
      this.beginLoading();
    } else {
      this.broadcastRoomState();
    }
    return { ok: true };
  }

  private setAssetsReady(peerId: string, ready: boolean): BasicActionResponse {
    const player = this.playerForPeer(peerId);
    if (!player) return this.error('NOT_IN_ROOM', '尚未加入房间。');
    if (this.phase !== 'loading') return this.error('ROOM_CLOSED', '当前不在加载阶段。');
    player.assetsReady = ready;
    if (!this.tryBeginLoadedMatch()) this.broadcastRoomState();
    return { ok: true };
  }

  private beginLoading(): void {
    for (const [playerId, player] of this.players) {
      if (!player.connected) this.players.delete(playerId);
    }
    this.promoteHost();
    this.engine = null;
    this.matchId = null;
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    for (const player of this.players.values()) {
      player.role = player.selectedRole;
      player.ready = false;
      player.assetsReady = false;
      player.latestInput = null;
    }
    this.phase = 'loading';
    this.notice = null;
    this.broadcastRoomState();
  }

  private tryBeginLoadedMatch(): boolean {
    const roster = [...this.players.values()].filter((player) => player.role !== null);
    const connectedRoster = roster.filter((player) => player.connected);
    if (
      this.phase !== 'loading'
      || roster.length < MIN_PLAYERS
      || roster.filter((player) => player.role === 'ghost').length !== 1
      || !connectedRoster.every((player) => player.assetsReady)
    ) return false;
    this.beginMatch(roster);
    return true;
  }

  private beginMatch(roster: PrototypePlayer[]): void {
    const ghost = roster.find((player) => player.role === 'ghost');
    if (!ghost) throw new Error('Locked room roster must contain exactly one ghost.');
    const children = roster.filter((player) => player.role === 'child');
    this.round += 1;
    this.matchId = randomId('match');
    this.engine = new MatchEngine({
      seed: Math.floor(Math.random() * 0x7fff_ffff),
      map: DEFAULT_HOUSE_MAP,
      ghostPlayerId: ghost.playerId,
      childPlayerIds: children.map((child) => child.playerId),
      gameplayTuning: this.gameplayTuning,
    });
    for (const player of roster) {
      player.ready = false;
      player.lastAcceptedSeq = -1;
      player.latestInput = null;
      player.lastInputAtMs = 0;
      player.lastInputMessageAtMs = 0;
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

  private acceptInput(peerId: string, rawFrame: ClientInputFrame): void {
    const player = this.playerForPeer(peerId);
    const frame = parseClientInputFrame(rawFrame);
    if (!player?.connected || !frame || !this.matchId || frame.matchId !== this.matchId || this.phase !== 'playing') return;
    const now = Date.now();
    if (now - player.lastInputMessageAtMs < MIN_INPUT_INTERVAL_MS) return;
    if (frame.seq <= player.lastAcceptedSeq) return;
    player.lastInputMessageAtMs = now;
    player.lastAcceptedSeq = frame.seq;
    player.latestInput = { ...frame };
    player.lastInputAtMs = now;
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
    const commands = buildAuthorityCommands(this.players.values(), now);
    const result = this.engine.advance(commands);
    if (result.events.length > 0) this.broadcastEvents(result.events);
    if (result.checkpoint.tick % FRAME_INTERVAL_TICKS === 0 || result.checkpoint.phase === 'ended') {
      this.broadcastFrame();
    }
    if (result.checkpoint.phase === 'ended') {
      this.phase = 'ended';
      const endedAtMs = Date.now();
      for (const player of this.players.values()) {
        player.selectedRole = null;
        player.ready = false;
        player.assetsReady = false;
        if (!player.connected) player.disconnectDeadlineMs = endedAtMs + RECONNECT_GRACE_MS;
      }
      this.promoteHost();
      this.scheduleExpirationSweep();
      if (this.tickHandle) clearInterval(this.tickHandle);
      this.tickHandle = null;
      this.broadcastRoomState();
    }
  }

  private broadcastFrame(): void {
    if (!this.engine || !this.matchId) return;
    const checkpoint = this.engine.checkpoint();
    const activeFlashlights = activeFlashlightPlayerIds(
      checkpoint,
      this.players.values(),
      this.gameplayTuning,
      Date.now(),
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
        selectedRole: player.selectedRole,
        role: player.role,
        ready: player.ready,
        assetsReady: player.assetsReady,
      })),
      minimumPlayers: MIN_PLAYERS,
      maximumPlayers: MAX_PLAYERS,
      notice: this.notice,
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
      this.promoteHost();
    } else if (this.phase === 'loading' || this.phase === 'playing') {
      this.disconnectDuringLockedRound(player);
      this.reconcileLoadingAfterDeparture();
    } else {
      player.connected = false;
      player.selectedRole = null;
      player.ready = false;
      player.assetsReady = false;
      player.latestInput = null;
      player.lastInputAtMs = 0;
      player.disconnectDeadlineMs = Date.now() + RECONNECT_GRACE_MS;
      this.promoteHost();
      this.scheduleExpirationSweep();
    }
    this.removeCachedResponses(peerId);
    this.postPlayerCount();
    this.broadcastRoomState();
  }

  private playerForPeer(peerId: string): PrototypePlayer | undefined {
    const playerId = this.peerPlayers.get(peerId);
    return playerId ? this.players.get(playerId) : undefined;
  }

  private handleRequest(
    peerId: string,
    requestId: string,
    action: () => RoomActionResponse | BasicActionResponse,
  ): void {
    const key = `${peerId}\u0000${requestId}`;
    const cached = this.responseCache.get(key);
    if (cached) {
      this.send(peerId, cached);
      return;
    }
    const response: Extract<HarmonyServerMessage, { type: 'response' }> = {
      type: 'response',
      requestId,
      result: action(),
    };
    this.responseCache.set(key, response);
    this.responseOrder.push(key);
    while (this.responseOrder.length > MAX_CACHED_RESPONSES) {
      const oldest = this.responseOrder.shift();
      if (oldest) this.responseCache.delete(oldest);
    }
    this.send(peerId, response);
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

  private connectedPlayers(): PrototypePlayer[] {
    return [...this.players.values()].filter((player) => player.connected);
  }

  private postPlayerCount(): void {
    this.post({ type: 'player-count', count: this.connectedPlayers().length });
  }

  private promoteHost(): void {
    if ([...this.players.values()].some((player) => player.connected && player.isHost)) return;
    for (const player of this.players.values()) player.isHost = false;
    const nextHost = this.connectedPlayers()[0];
    if (nextHost) nextHost.isHost = true;
  }

  private disconnectDuringLockedRound(player: PrototypePlayer): void {
    player.connected = false;
    player.lastInputAtMs = 0;
    player.lastInputMessageAtMs = 0;
    player.assetsReady = false;
    player.disconnectDeadlineMs = null;
    this.broadcastFrame();
  }

  private removeCachedResponses(peerId: string): void {
    const prefix = `${peerId}\u0000`;
    for (const key of this.responseCache.keys()) {
      if (key.startsWith(prefix)) this.responseCache.delete(key);
    }
    for (let index = this.responseOrder.length - 1; index >= 0; index -= 1) {
      if (this.responseOrder[index].startsWith(prefix)) this.responseOrder.splice(index, 1);
    }
  }

  private reconcileLoadingAfterDeparture(): void {
    if (this.phase !== 'loading') return;
    this.tryBeginLoadedMatch();
  }

  private restore(peerId: string, playerId: string, rejoinToken: string): RoomActionResponse | null {
    const player = this.players.get(playerId);
    if (
      !player
      || player.connected
      || !player.rejoinToken
      || player.rejoinToken !== rejoinToken
      || this.peerPlayers.has(peerId)
      || !this.canRestore(player)
    ) return null;
    player.peerId = peerId;
    player.connected = true;
    player.disconnectDeadlineMs = null;
    player.lastInputAtMs = 0;
    player.lastInputMessageAtMs = 0;
    this.peerPlayers.set(peerId, player.playerId);
    this.broadcastRoomState();
    this.broadcastFrame();
    this.postPlayerCount();
    this.scheduleExpirationSweep();
    return {
      ok: true,
      session: {
        roomCode: this.roomCode,
        playerId: player.playerId,
        rejoinToken: player.rejoinToken,
        isHost: player.isHost,
      },
    };
  }

  private validateConnectedSelection(): { ok: false; error: { code: RoomErrorCode; message: string } } | null {
    const connectedPlayers = this.connectedPlayers();
    if (connectedPlayers.length < MIN_PLAYERS) {
      return this.error('NOT_ENOUGH_PLAYERS', '至少需要两名玩家。');
    }
    if (
      connectedPlayers.some((player) => player.selectedRole === null)
      || connectedPlayers.filter((player) => player.selectedRole === 'ghost').length !== 1
    ) {
      return this.error('ROLE_SELECTION_REQUIRED', '所有玩家必须选择阵营，且必须恰好有一名鬼。');
    }
    return null;
  }

  private canRestore(player: PrototypePlayer): boolean {
    if (this.phase === 'loading' || this.phase === 'playing') return true;
    return this.phase === 'ended'
      && player.disconnectDeadlineMs !== null
      && player.disconnectDeadlineMs >= Date.now();
  }

  private scheduleExpirationSweep(): void {
    if (this.expirationHandle) clearTimeout(this.expirationHandle);
    this.expirationHandle = null;
    const deadlines = [...this.players.values()]
      .map((player) => player.disconnectDeadlineMs)
      .filter((deadline): deadline is number => deadline !== null);
    if (deadlines.length === 0) return;
    const delayMs = Math.max(0, Math.min(...deadlines) - Date.now());
    this.expirationHandle = setTimeout(() => {
      this.expirationHandle = null;
      this.expireDisconnectedPlayers();
      this.scheduleExpirationSweep();
    }, delayMs);
  }

  private expireDisconnectedPlayers(): void {
    const nowMs = Date.now();
    let changed = false;
    for (const [playerId, player] of this.players) {
      if (player.connected || player.disconnectDeadlineMs === null || player.disconnectDeadlineMs > nowMs) {
        continue;
      }
      this.players.delete(playerId);
      changed = true;
    }
    if (!changed) return;
    this.promoteHost();
    this.postPlayerCount();
    this.broadcastRoomState();
  }

  private close(): void {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    if (this.expirationHandle) clearTimeout(this.expirationHandle);
    this.expirationHandle = null;
    this.engine = null;
    this.players.clear();
    this.peerPlayers.clear();
    this.phase = 'lobby';
    this.matchId = null;
    this.round = 0;
    this.notice = null;
    this.responseCache.clear();
    this.responseOrder.length = 0;
  }
}

function randomId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

const room = new HarmonyHostedRoomPrototype();
self.onmessage = (event: MessageEvent<HarmonyWorkerInput>) => room.receive(event.data);
