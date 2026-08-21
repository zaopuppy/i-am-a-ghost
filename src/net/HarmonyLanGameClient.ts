import {
  clearHarmonyRoomSurfaces,
  createHarmonyPrototypeRoom,
  findHarmonyRoomByCode,
  type HarmonyHostApi,
} from './HarmonyHostBridge';
import { EventLedger } from './EventLedger';
import type { GameClientListener, NetworkStats } from './GameClient';
import {
  BUILD_VERSION,
  PROTOCOL_VERSION,
  type BasicActionResponse,
  type ClientInputFrame,
  type GameplayTuning,
  type HarmonyActionResult,
  type HarmonyClientMessage,
  type HarmonyServerMessage,
  type HarmonyWorkerInput,
  type HarmonyWorkerOutput,
  type MatchEventEnvelope,
  type MatchFrameEnvelope,
  type RoomActionResponse,
  type RoomSession,
  type RoomState,
} from './protocol';
import type { HarmonyRoomEndpoint } from './HarmonyLanProtocol';

interface NativeAccepted {
  accepted?: unknown;
  error?: unknown;
}

interface NativeGameConnectionStatus {
  state?: unknown;
  error?: unknown;
}

interface NativeInboxMessage {
  peerId?: unknown;
  payload?: unknown;
}

interface PendingRequest {
  resolve: (result: HarmonyActionResult) => void;
  timer: number;
}

const LOCAL_PEER_ID = 'local';
const REQUEST_TIMEOUT_MS = 6_000;

export class HarmonyLanGameClient {
  connected = true;
  session: RoomSession | null = null;
  roomState: RoomState | null = null;
  latestFrame: MatchFrameEnvelope | null = null;
  latestEvents: MatchEventEnvelope | null = null;
  errorMessage = '';
  private readonly listeners = new Set<GameClientListener>();
  private readonly eventLedger = new EventLedger();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly inputSentAt = new Map<number, number>();
  private readonly pollTimer: number;
  private worker: Worker | null = null;
  private hostMode = false;
  private inputSequence = 0;
  private clientTick = 0;
  private lastFrameReceivedAt = 0;
  private lastAckLatencyMs: number | null = null;

  constructor(private readonly host: HarmonyHostApi) {
    this.pollTimer = window.setInterval(() => this.pollNative(), 25);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  subscribe(listener: GameClientListener): () => void {
    this.listeners.add(listener);
    listener();
    return () => this.listeners.delete(listener);
  }

  async createRoom(nickname: string): Promise<RoomActionResponse> {
    this.resetSession();
    const endpoint = await createHarmonyPrototypeRoom();
    if (endpoint === null || endpoint.instanceId.length < 1) {
      return this.failRoomAction('原生层没有创建可用房间。');
    }
    this.hostMode = true;
    this.startWorker(endpoint.roomCode);
    const result = await this.request({
      type: 'create-room',
      requestId: requestId(),
      nickname,
    });
    return this.acceptRoomAction(result);
  }

  async joinRoom(roomCode: string, nickname: string): Promise<RoomActionResponse> {
    const endpoint = findHarmonyRoomByCode(roomCode);
    if (endpoint === null) return this.failRoomAction('附近没有找到这个房间码。');
    return this.joinEndpoint(endpoint, nickname);
  }

  async joinEndpoint(endpoint: HarmonyRoomEndpoint, nickname: string): Promise<RoomActionResponse> {
    this.resetSession();
    this.hostMode = false;
    const accepted = JSON.parse(this.host.connectGameRoom(
      endpoint.host,
      endpoint.port,
      endpoint.roomCode,
      endpoint.instanceId,
    )) as NativeAccepted;
    if (accepted.accepted !== true) {
      return this.failRoomAction(typeof accepted.error === 'string' ? accepted.error : '原生层拒绝房间地址。');
    }
    const connected = await this.waitForNativeConnection();
    if (!connected) return this.failRoomAction(this.errorMessage || '无法连接房间主机。');
    const result = await this.request({
      type: 'join-room',
      requestId: requestId(),
      protocolVersion: PROTOCOL_VERSION,
      buildVersion: BUILD_VERSION,
      roomCode: endpoint.roomCode,
      nickname,
    });
    return this.acceptRoomAction(result);
  }

  async startMatch(): Promise<BasicActionResponse> {
    const result = await this.request({ type: 'start-match', requestId: requestId() });
    return this.acceptBasicAction(result);
  }

  async setReady(ready: boolean): Promise<BasicActionResponse> {
    const result = await this.request({ type: 'set-ready', requestId: requestId(), ready });
    return this.acceptBasicAction(result);
  }

  async setDebugTuning(_tuning: GameplayTuning): Promise<BasicActionResponse> {
    const result: BasicActionResponse = {
      ok: false,
      error: { code: 'BAD_REQUEST', message: '鸿蒙局域网原型暂不支持在线调参。' },
    };
    this.errorMessage = result.error.message;
    this.notify();
    return result;
  }

  sendInput(input: Omit<ClientInputFrame, 'matchId' | 'seq' | 'clientTick'>): void {
    const matchId = this.roomState?.matchId;
    if (!this.connected || !matchId || this.roomState?.phase !== 'playing') return;
    this.inputSequence += 1;
    this.clientTick += 1;
    this.inputSentAt.set(this.inputSequence, performance.now());
    this.sendClientMessage({
      type: 'input-frame',
      frame: {
        matchId,
        seq: this.inputSequence,
        clientTick: this.clientTick,
        ...input,
      },
    });
  }

  networkStats(): NetworkStats {
    return {
      pendingInputs: this.inputSentAt.size,
      lastAckLatencyMs: this.lastAckLatencyMs,
      frameAgeMs: this.lastFrameReceivedAt > 0 ? performance.now() - this.lastFrameReceivedAt : null,
      reconnecting: false,
    };
  }

  dispose(): void {
    window.clearInterval(this.pollTimer);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.resetSession();
    this.listeners.clear();
  }

  private startWorker(roomCode: string): void {
    this.worker?.terminate();
    const worker = new Worker(new URL('./HarmonyRoomWorker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<HarmonyWorkerOutput>) => {
      const message = event.data;
      if (message.type === 'player-count') {
        this.host.setHostedRoomPlayers(message.count);
      } else if (message.peerId === LOCAL_PEER_ID) {
        this.acceptServerPayload(message.payload);
      } else {
        this.host.sendGamePeer(message.peerId, message.payload);
      }
    });
    worker.addEventListener('error', (event) => {
      this.errorMessage = `房间 Worker 失败：${event.message}`;
      this.notify();
    });
    this.worker = worker;
    worker.postMessage({ type: 'configure', roomCode } satisfies HarmonyWorkerInput);
  }

  private request(message: HarmonyClientMessage): Promise<HarmonyActionResult> {
    if (!('requestId' in message)) {
      return Promise.resolve({ ok: false, error: { code: 'BAD_REQUEST', message: '请求缺少 ID。' } });
    }
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(message.requestId);
        resolve({ ok: false, error: { code: 'BAD_REQUEST', message: '房间请求超时。' } });
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(message.requestId, { resolve, timer });
      if (!this.sendClientMessage(message)) {
        window.clearTimeout(timer);
        this.pending.delete(message.requestId);
        resolve({ ok: false, error: { code: 'BAD_REQUEST', message: '房间连接尚未就绪。' } });
      }
    });
  }

  private sendClientMessage(message: HarmonyClientMessage): boolean {
    const payload = JSON.stringify(message);
    if (this.hostMode) {
      if (this.worker === null) return false;
      this.worker.postMessage({ type: 'peer-message', peerId: LOCAL_PEER_ID, payload } satisfies HarmonyWorkerInput);
      return true;
    }
    const result = JSON.parse(this.host.sendGameMessage(payload)) as NativeAccepted;
    return result.accepted === true;
  }

  private pollNative(): void {
    let messages: NativeInboxMessage[];
    try {
      const parsed = JSON.parse(this.host.drainGameMessages()) as unknown;
      messages = Array.isArray(parsed) ? parsed as NativeInboxMessage[] : [];
    } catch {
      return;
    }
    for (const message of messages) {
      if (typeof message.peerId !== 'string' || typeof message.payload !== 'string') continue;
      if (this.hostMode && this.worker !== null) {
        if (message.payload === '{"type":"peer-disconnected"}') {
          this.worker.postMessage({ type: 'peer-disconnected', peerId: message.peerId } satisfies HarmonyWorkerInput);
        } else {
          this.worker.postMessage({
            type: 'peer-message',
            peerId: message.peerId,
            payload: message.payload,
          } satisfies HarmonyWorkerInput);
        }
      } else {
        this.acceptServerPayload(message.payload);
      }
    }
  }

  private acceptServerPayload(payload: string): void {
    let message: HarmonyServerMessage;
    try {
      message = JSON.parse(payload) as HarmonyServerMessage;
    } catch {
      return;
    }
    switch (message.type) {
      case 'response': {
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        window.clearTimeout(pending.timer);
        this.pending.delete(message.requestId);
        pending.resolve(message.result);
        break;
      }
      case 'room-state':
        this.roomState = message.state;
        this.notify();
        break;
      case 'match-frame':
        if (message.envelope.protocolVersion !== PROTOCOL_VERSION) return;
        this.latestFrame = message.envelope;
        this.lastFrameReceivedAt = performance.now();
        this.acknowledgeInput(message.envelope.ackSeq);
        this.notify();
        break;
      case 'match-events': {
        const events = this.eventLedger.accept(message.envelope);
        if (events.length === 0) return;
        this.latestEvents = { ...message.envelope, events };
        this.notify();
        break;
      }
      case 'room-error':
        this.errorMessage = message.message;
        this.notify();
        break;
      case 'host-closed':
        this.connected = false;
        this.errorMessage = '房间主机已离开。';
        this.notify();
        break;
    }
  }

  private acknowledgeInput(sequence: number): void {
    const acknowledgedAt = this.inputSentAt.get(sequence);
    if (acknowledgedAt !== undefined) this.lastAckLatencyMs = performance.now() - acknowledgedAt;
    for (const pendingSequence of this.inputSentAt.keys()) {
      if (pendingSequence <= sequence) this.inputSentAt.delete(pendingSequence);
    }
  }

  private acceptRoomAction(result: HarmonyActionResult): RoomActionResponse {
    const response = result as RoomActionResponse;
    if (response.ok && 'session' in response) {
      this.session = response.session;
      this.errorMessage = '';
      this.connected = true;
    } else if (!response.ok) {
      this.errorMessage = response.error.message;
    }
    this.notify();
    return response;
  }

  private acceptBasicAction(result: HarmonyActionResult): BasicActionResponse {
    const response = result as BasicActionResponse;
    if (!response.ok) this.errorMessage = response.error.message;
    this.notify();
    return response;
  }

  private failRoomAction(message: string): RoomActionResponse {
    const response: RoomActionResponse = { ok: false, error: { code: 'ROOM_NOT_FOUND', message } };
    this.errorMessage = message;
    this.notify();
    return response;
  }

  private resetSession(): void {
    this.worker?.postMessage({ type: 'close' } satisfies HarmonyWorkerInput);
    this.worker?.terminate();
    this.worker = null;
    this.host.closeHostedRoom();
    clearHarmonyRoomSurfaces();
    this.hostMode = false;
    this.session = null;
    this.roomState = null;
    this.latestFrame = null;
    this.latestEvents = null;
    this.errorMessage = '';
    this.inputSequence = 0;
    this.clientTick = 0;
    this.lastFrameReceivedAt = 0;
    this.lastAckLatencyMs = null;
    this.inputSentAt.clear();
    this.eventLedger.clear();
    for (const pending of this.pending.values()) window.clearTimeout(pending.timer);
    this.pending.clear();
    this.notify();
  }

  private readonly onVisibilityChange = (): void => {
    if (!document.hidden) return;
    if (this.session === null && this.worker === null && !this.hostMode) return;
    this.resetSession();
  };

  private async waitForNativeConnection(): Promise<boolean> {
    const startedAt = performance.now();
    while (performance.now() - startedAt < REQUEST_TIMEOUT_MS) {
      const status = JSON.parse(this.host.gameConnectionStatus()) as NativeGameConnectionStatus;
      if (status.state === 'connected') return true;
      if (status.state === 'error') {
        this.errorMessage = typeof status.error === 'string' ? status.error : '原生 TCP 连接失败。';
        this.notify();
        return false;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    this.errorMessage = '连接房间主机超时。';
    this.notify();
    return false;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

function requestId(): string {
  return `request-${crypto.randomUUID()}`;
}
