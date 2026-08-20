export interface HarmonyHostState {
  active: boolean;
  bridgeVersion: number | null;
  platform: string;
  error: string | null;
}

interface HarmonyHostApi {
  ping(message: string): string;
  runtimeInfo(): string;
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
    return { active: false, bridgeVersion: null, platform: 'browser', error: null };
  }

  try {
    const pong = host.ping('web-ready');
    const rawInfo = JSON.parse(host.runtimeInfo()) as HarmonyRuntimeInfo;
    const state: HarmonyHostState = {
      active: pong === 'pong:web-ready',
      bridgeVersion: typeof rawInfo.bridgeVersion === 'number' ? rawInfo.bridgeVersion : null,
      platform: typeof rawInfo.platform === 'string' ? rawInfo.platform : 'HarmonyOS',
      error: null,
    };
    const report = JSON.stringify({
      href: window.location.href,
      bridgeVersion: state.bridgeVersion,
      webgl2: Boolean(document.createElement('canvas').getContext('webgl2')),
    });
    host.reportReady(report);
    surfaceState(state);
    console.info(`[HarmonyGateA] bridge ready ${report}`);
    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const state: HarmonyHostState = {
      active: false,
      bridgeVersion: null,
      platform: 'HarmonyOS',
      error: message,
    };
    surfaceState(state);
    console.error(`[HarmonyGateA] bridge failed: ${message}`);
    return state;
  }
}

function surfaceState(state: HarmonyHostState): void {
  document.documentElement.dataset.harmonyHost = state.active ? 'ready' : 'failed';
  const output = document.createElement('output');
  output.dataset.harmonyGateA = state.active ? 'ready' : 'failed';
  output.textContent = state.active
    ? `Harmony Gate A · bridge v${state.bridgeVersion ?? '?'}`
    : `Harmony Gate A · bridge failed: ${state.error ?? 'unknown'}`;
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
}
