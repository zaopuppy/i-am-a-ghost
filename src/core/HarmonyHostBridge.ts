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
  reportReady(payload: string): string;
}

interface HarmonyRuntimeInfo {
  platform?: unknown;
  prototype?: unknown;
  bridgeVersion?: unknown;
}

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
    const report = JSON.stringify({
      href: window.location.href,
      bridgeVersion: state.bridgeVersion,
      webgl2: Boolean(document.createElement('canvas').getContext('webgl2')),
    });
    host.reportReady(report);
    const output = surfaceState(state);
    const nearbyOutput = surfaceNearbyRooms(state.nearbyRooms);
    window.setInterval(() => {
      state.lan = readLanStatus(host);
      state.nearbyRooms = readNearbyRooms(host);
      output.textContent = readyLabel(state);
      nearbyOutput.textContent = nearbyRoomsLabel(state.nearbyRooms);
    }, 1_000);
    console.info(`[HarmonyGateA] bridge ready ${report}`);
    return state;
  } catch (error) {
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
