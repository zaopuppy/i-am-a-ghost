import QRCode from 'qrcode';

export interface HarmonyHostState {
  active: boolean;
  bridgeVersion: number | null;
  platform: string;
  error: string | null;
  lan: HarmonyLanHostStatus | null;
  nearbyRooms: HarmonyNearbyRoom[];
}

interface HarmonyLanHostStatus {
  listening?: unknown;
  port?: unknown;
  mdnsRegistered?: unknown;
}

interface HarmonyNearbyRoom {
  serviceName?: unknown;
  host?: unknown;
  port?: unknown;
  protocol?: unknown;
  state?: unknown;
  receivedBytes?: unknown;
}

interface HarmonyHostApi {
  ping(message: string): string;
  runtimeInfo(): string;
  lanStatus(): string;
  nearbyRooms(): string;
  createPrototypeRoom(): string;
  joinPrototypeRoom(host: string, port: number, roomCode: string, instanceId: string): string;
  startQrScan(): string;
  qrScanStatus(): string;
  reportReady(payload: string): string;
}

interface HarmonyPrototypeRoom {
  ok?: unknown;
  roomCode?: unknown;
  instanceId?: unknown;
  host?: unknown;
  port?: unknown;
  payload?: unknown;
  error?: unknown;
}

interface HarmonyQrScanStatus {
  state?: unknown;
  payload?: unknown;
  error?: unknown;
}

interface HarmonyJoinStatus {
  accepted?: unknown;
  serviceName?: unknown;
  error?: unknown;
}

interface HarmonyRuntimeInfo {
  platform?: unknown;
  prototype?: unknown;
  bridgeVersion?: unknown;
}

let activeHost: HarmonyHostApi | null = null;
let scanPoll: number | null = null;

export function initializeHarmonyHost(): HarmonyHostState {
  const host = (window as Window & { harmonyHost?: HarmonyHostApi }).harmonyHost;
  if (!host) {
    return {
      active: false,
      bridgeVersion: null,
      platform: 'browser',
      error: null,
      lan: null,
      nearbyRooms: [],
    };
  }

  try {
    const pong = host.ping('web-ready');
    const rawInfo = JSON.parse(host.runtimeInfo()) as HarmonyRuntimeInfo;
    const rawLan = readLanStatus(host);
    const state: HarmonyHostState = {
      active: pong === 'pong:web-ready',
      bridgeVersion: typeof rawInfo.bridgeVersion === 'number' ? rawInfo.bridgeVersion : null,
      platform: typeof rawInfo.platform === 'string' ? rawInfo.platform : 'HarmonyOS',
      error: null,
      lan: rawLan,
      nearbyRooms: readNearbyRooms(host),
    };
    activeHost = host;
    const report = JSON.stringify({
      href: window.location.href,
      bridgeVersion: state.bridgeVersion,
      webgl2: Boolean(document.createElement('canvas').getContext('webgl2')),
    });
    host.reportReady(report);
    const output = surfaceState(state);
    const nearbyOutput = surfaceNearbyRooms(state.nearbyRooms);
    surfaceQrJoinButton();
    window.setInterval(() => {
      state.lan = readLanStatus(host);
      state.nearbyRooms = readNearbyRooms(host);
      output.textContent = readyLabel(state);
      nearbyOutput.textContent = nearbyRoomsLabel(state.nearbyRooms);
    }, 1_000);
    console.info(`[HarmonyGateA] bridge ready ${report}`);
    return state;
  } catch (error) {
    activeHost = null;
    const message = error instanceof Error ? error.message : String(error);
    const state: HarmonyHostState = {
      active: false,
      bridgeVersion: null,
      platform: 'HarmonyOS',
      error: message,
      lan: null,
      nearbyRooms: [],
    };
    surfaceState(state);
    console.error(`[HarmonyGateA] bridge failed: ${message}`);
    return state;
  }
}

export async function createHarmonyPrototypeRoom(): Promise<void> {
  const host = activeHost;
  if (host === null) return;
  setHarmonyError('');
  setNetworkStatus('正在创建二维码探针房间…');
  try {
    const room = JSON.parse(host.createPrototypeRoom()) as HarmonyPrototypeRoom;
    if (
      room.ok !== true
      || typeof room.roomCode !== 'string'
      || typeof room.host !== 'string'
      || typeof room.port !== 'number'
      || typeof room.payload !== 'string'
    ) {
      throw new Error(typeof room.error === 'string' ? room.error : '原生层没有返回可用地址');
    }
    const panel = surfaceQrRoom(room.roomCode, room.host, room.port, room.payload);
    const canvas = panel.querySelector<HTMLCanvasElement>('canvas');
    if (canvas === null) throw new Error('二维码画布创建失败');
    await QRCode.toCanvas(canvas, room.payload, {
      width: 176,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#08090d', light: '#ffffff' },
    });
    setNetworkStatus('二维码探针房间已创建');
  } catch (error) {
    setNetworkStatus('二维码探针房间创建失败');
    setHarmonyError(error instanceof Error ? error.message : String(error));
  }
}

export function startHarmonyQrScan(): void {
  const host = activeHost;
  if (host === null || scanPoll !== null) return;
  try {
    setHarmonyError('');
    const start = JSON.parse(host.startQrScan()) as { started?: unknown; error?: unknown };
    if (start.started !== true) {
      throw new Error(typeof start.error === 'string' ? start.error : '系统扫码界面启动失败');
    }
    setNetworkStatus('正在扫描房间二维码…');
    const startedAt = performance.now();
    scanPoll = window.setInterval(() => {
      const scan = JSON.parse(host.qrScanStatus()) as HarmonyQrScanStatus;
      if (scan.state === 'scanning' && performance.now() - startedAt < 90_000) return;
      stopScanPoll();
      if (scan.state === 'success' && typeof scan.payload === 'string') {
        joinScannedRoom(host, scan.payload);
      } else if (scan.state === 'cancelled') {
        setNetworkStatus('已取消扫描二维码');
      } else {
        setNetworkStatus('二维码扫描失败');
        setHarmonyError(typeof scan.error === 'string' ? scan.error : '扫描超时或没有返回内容');
      }
    }, 300);
  } catch (error) {
    stopScanPoll();
    setNetworkStatus('二维码扫描失败');
    setHarmonyError(error instanceof Error ? error.message : String(error));
  }
}

function surfaceState(state: HarmonyHostState): HTMLOutputElement {
  document.documentElement.dataset.harmonyHost = state.active ? 'ready' : 'failed';
  const output = document.createElement('output');
  output.dataset.harmonyGateA = state.active ? 'ready' : 'failed';
  output.textContent = state.active ? readyLabel(state) : failedLabel(state);
  output.style.cssText = [
    'position:fixed',
    'z-index:10000',
    'top:max(8px, env(safe-area-inset-top))',
    'left:max(8px, env(safe-area-inset-left))',
    'padding:6px 10px',
    'border:1px solid rgba(167,243,208,.5)',
    'border-radius:999px',
    'background:rgba(3,20,17,.82)',
    'color:#a7f3d0',
    'font:600 11px/1.2 system-ui,sans-serif',
    'pointer-events:none',
  ].join(';');
  document.body.append(output);
  return output;
}

function surfaceQrJoinButton(): void {
  if (document.querySelector('[data-harmony-scan-qr]') !== null) return;
  const actions = document.querySelector<HTMLElement>('#lobby-actions');
  if (actions === null) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.harmonyScanQr = 'true';
  button.textContent = '扫码加入探针房间';
  button.style.cssText = [
    'width:100%',
    'padding:10px 14px',
    'border:1px solid rgba(216,189,114,.55)',
    'background:rgba(12,12,17,.82)',
    'color:#ead99f',
    'font:700 13px/1.2 system-ui,sans-serif',
  ].join(';');
  button.addEventListener('click', startHarmonyQrScan);
  actions.append(button);
}

function surfaceQrRoom(roomCode: string, host: string, port: number, payload: string): HTMLElement {
  document.querySelector('[data-harmony-qr-room]')?.remove();
  const panel = document.createElement('aside');
  panel.dataset.harmonyQrRoom = 'true';
  panel.style.cssText = [
    'position:fixed',
    'z-index:10001',
    'right:max(18px, env(safe-area-inset-right))',
    'bottom:max(18px, env(safe-area-inset-bottom))',
    'width:min(210px,calc(42vw - 24px))',
    'padding:12px',
    'border:1px solid rgba(216,189,114,.72)',
    'background:rgba(8,9,13,.96)',
    'color:#ead99f',
    'font:600 11px/1.35 system-ui,sans-serif',
    'text-align:center',
  ].join(';');
  const title = document.createElement('strong');
  title.textContent = '二维码探针房间';
  const code = document.createElement('div');
  code.dataset.harmonyQrCode = 'true';
  code.textContent = roomCode;
  code.style.cssText = 'margin:5px 0;font:800 22px/1 system-ui,sans-serif;letter-spacing:.12em';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', '房间连接二维码');
  canvas.style.cssText = 'display:block;width:min(176px,100%);height:auto;margin:8px auto;background:#fff';
  const endpoint = document.createElement('div');
  endpoint.textContent = `${host}:${port}`;
  endpoint.style.cssText = 'margin-top:6px;overflow-wrap:anywhere;color:#a7f3d0';
  const hint = document.createElement('small');
  hint.textContent = '另一台手机点击“扫码加入探针房间”';
  hint.title = payload;
  hint.style.cssText = 'display:block;margin-top:5px;color:#aaa';
  panel.append(title, code, canvas, endpoint, hint);
  document.body.append(panel);
  return panel;
}

function joinScannedRoom(host: HarmonyHostApi, payload: string): void {
  try {
    const endpoint = parseQrPayload(payload);
    const joined = JSON.parse(host.joinPrototypeRoom(
      endpoint.host,
      endpoint.port,
      endpoint.roomCode,
      endpoint.instanceId,
    )) as HarmonyJoinStatus;
    if (joined.accepted !== true || typeof joined.serviceName !== 'string') {
      throw new Error(typeof joined.error === 'string' ? joined.error : '原生层拒绝二维码地址');
    }
    setNetworkStatus('二维码已解析，正在直连探针房间…');
    watchJoinedRoom(host, joined.serviceName);
  } catch (error) {
    setNetworkStatus('二维码内容无效');
    setHarmonyError(error instanceof Error ? error.message : String(error));
  }
}

function watchJoinedRoom(host: HarmonyHostApi, serviceName: string): void {
  const startedAt = performance.now();
  const timer = window.setInterval(() => {
    const room = readNearbyRooms(host).find((candidate) => candidate.serviceName === serviceName);
    if (room?.state === 'reachable') {
      window.clearInterval(timer);
      setNetworkStatus('二维码直连成功');
    } else if (room?.state === 'unreachable' || performance.now() - startedAt > 6_000) {
      window.clearInterval(timer);
      setNetworkStatus('二维码已识别，但两台手机无法直连');
      setHarmonyError('二维码只能绕过 mDNS；当前网络仍阻止设备间 TCP 连接。');
    }
  }, 300);
}

function parseQrPayload(payload: string): {
  host: string;
  port: number;
  roomCode: string;
  instanceId: string;
} {
  const prefix = 'iamaghost://gate-a/join?';
  const search = payload.startsWith(prefix) ? new URLSearchParams(payload.slice(prefix.length)) : null;
  const host = search?.get('host') ?? '';
  const port = Number.parseInt(search?.get('port') ?? '', 10);
  const roomCode = search?.get('room') ?? '';
  const instanceId = search?.get('instance') ?? '';
  if (
    search === null
    || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)
    || !Number.isInteger(port)
    || port < 1
    || port > 65_535
    || !/^[A-Z0-9]{6}$/.test(roomCode)
    || instanceId.length < 1
    || instanceId.length > 80
  ) throw new Error('不是有效的 Gate A 房间二维码');
  return { host, port, roomCode, instanceId };
}

function stopScanPoll(): void {
  if (scanPoll === null) return;
  window.clearInterval(scanPoll);
  scanPoll = null;
}

function setNetworkStatus(message: string): void {
  const status = document.querySelector<HTMLElement>('#network-status');
  if (status !== null) {
    status.dataset.harmonyManaged = 'true';
    status.textContent = message;
  }
}

function setHarmonyError(message: string): void {
  const output = document.querySelector<HTMLElement>('#error-message');
  if (output !== null) output.textContent = message;
}

function readLanStatus(host: HarmonyHostApi): HarmonyLanHostStatus | null {
  const parsed = JSON.parse(host.lanStatus()) as HarmonyLanHostStatus;
  return typeof parsed === 'object' && parsed !== null ? parsed : null;
}

function readNearbyRooms(host: HarmonyHostApi): HarmonyNearbyRoom[] {
  const parsed = JSON.parse(host.nearbyRooms()) as unknown;
  return Array.isArray(parsed) ? parsed as HarmonyNearbyRoom[] : [];
}

function surfaceNearbyRooms(rooms: HarmonyNearbyRoom[]): HTMLElement {
  const output = document.createElement('aside');
  output.dataset.harmonyNearbyRooms = 'true';
  output.textContent = nearbyRoomsLabel(rooms);
  output.style.cssText = [
    'position:fixed',
    'z-index:10000',
    'top:max(48px, calc(env(safe-area-inset-top) + 48px))',
    'right:max(8px, env(safe-area-inset-right))',
    'max-width:min(480px,calc(100vw - 16px))',
    'padding:7px 10px',
    'border:1px solid rgba(216,189,114,.38)',
    'background:rgba(12,12,17,.88)',
    'color:#ead99f',
    'font:600 10px/1.45 system-ui,sans-serif',
    'white-space:pre-line',
    'overflow-wrap:anywhere',
    'pointer-events:none',
  ].join(';');
  document.body.append(output);
  return output;
}

function nearbyRoomsLabel(rooms: HarmonyNearbyRoom[]): string {
  if (rooms.length === 0) return '附近原型房间 · 搜索中（0）';
  const lines = rooms.map((room) => {
    const serviceName = typeof room.serviceName === 'string' ? room.serviceName : '未命名';
    const state = typeof room.state === 'string' ? room.state : 'found';
    const host = typeof room.host === 'string' ? room.host : '?';
    const port = typeof room.port === 'number' ? room.port : '?';
    const receivedBytes = typeof room.receivedBytes === 'number' ? ` · ${room.receivedBytes}B` : '';
    return `${serviceName} · ${state} · ${host}:${port}${receivedBytes}`;
  });
  return `附近原型房间 · ${rooms.length}\n${lines.join('\n')}`;
}

function readyLabel(state: HarmonyHostState): string {
  return `Harmony Gate A · bridge v${state.bridgeVersion ?? '?'} · ${formatLanStatus(state.lan)}`;
}

function failedLabel(state: HarmonyHostState): string {
  return `Harmony Gate A · bridge failed: ${state.error ?? 'unknown'}`;
}

function formatLanStatus(status: HarmonyLanHostStatus | null): string {
  if (!status || status.listening !== true || typeof status.port !== 'number') return 'LAN starting';
  return `LAN :${status.port}${status.mdnsRegistered === true ? ' + mDNS' : ''}`;
}
