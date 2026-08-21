import { common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { BusinessError } from '@kit.BasicServicesKit';
import { scanBarcode, scanCore } from '@kit.ScanKit';
import BuildProfile from 'entry/BuildProfile';
import { lanHostProbe } from '../network/LanHostProbe';

const BRIDGE_PERMISSION = '{"javascriptProxyPermission":{"urlPermissionList":' +
  '[{"scheme":"https","host":"game.local","port":"","path":""}]}}';
const GAME_ORIGIN = 'https://game.local/';

interface QrScanStatus {
  state: string;
  payload: string | null;
  error: string | null;
}

class HarmonyHostBridge {
  private context: common.Context | null = null;
  private scanStatus: QrScanStatus = { state: 'idle', payload: null, error: null };

  setContext(context: common.Context): void {
    this.context = context;
  }

  ping(message: string): string {
    console.info(`[HarmonyGateA] bridge ping: ${message}`);
    return `pong:${message}`;
  }

  runtimeInfo(): string {
    return '{"platform":"HarmonyOS","prototype":"gate-a","bridgeVersion":1}';
  }

  lanStatus(): string {
    return JSON.stringify(lanHostProbe.status());
  }

  nearbyRooms(): string {
    return JSON.stringify(lanHostProbe.nearbyRooms());
  }

  createPrototypeRoom(): string {
    return JSON.stringify(lanHostProbe.createPrototypeRoom());
  }

  joinPrototypeRoom(host: string, port: number, roomCode: string, instanceId: string): string {
    return JSON.stringify(lanHostProbe.joinPrototypeRoom(host, port, roomCode, instanceId));
  }

  connectGameRoom(host: string, port: number, roomCode: string, instanceId: string): string {
    return JSON.stringify(lanHostProbe.connectGameRoom(host, port, roomCode, instanceId));
  }

  gameConnectionStatus(): string {
    return JSON.stringify(lanHostProbe.gameConnectionStatus());
  }

  drainGameMessages(): string {
    return JSON.stringify(lanHostProbe.drainGameMessages());
  }

  sendGameMessage(payload: string): string {
    return JSON.stringify({ accepted: lanHostProbe.sendGameMessage(payload) });
  }

  sendGamePeer(peerId: string, payload: string): string {
    return JSON.stringify({ accepted: lanHostProbe.sendGamePeer(peerId, payload) });
  }

  setHostedRoomPlayers(players: number): string {
    return JSON.stringify({ accepted: lanHostProbe.setHostedRoomPlayers(players) });
  }

  closeHostedRoom(): string {
    lanHostProbe.closeHostedRoom();
    return '{"accepted":true}';
  }

  startQrScan(): string {
    if (this.context === null) {
      this.scanStatus = { state: 'error', payload: null, error: 'UI context is not ready' };
      return JSON.stringify({ started: false, error: this.scanStatus.error });
    }
    if (this.scanStatus.state === 'scanning') return '{"started":true}';
    this.scanStatus = { state: 'scanning', payload: null, error: null };
    try {
      void scanBarcode.startScanForResult(this.context, {
        scanTypes: [scanCore.ScanType.QR_CODE],
        enableMultiMode: false,
        enableAlbum: true,
      }).then((result) => {
        this.scanStatus = { state: 'success', payload: result.originalValue, error: null };
      }).catch((error: BusinessError) => {
        this.scanStatus = {
          state: error.code === 1000500002 ? 'cancelled' : 'error',
          payload: null,
          error: error.message,
        };
      });
      return '{"started":true}';
    } catch (error) {
      this.scanStatus = { state: 'error', payload: null, error: stringifyError(error) };
      return JSON.stringify({ started: false, error: this.scanStatus.error });
    }
  }

  qrScanStatus(): string {
    return JSON.stringify(this.scanStatus);
  }

  reportReady(payload: string): string {
    console.info(`[HarmonyGateA] web ready: ${payload}`);
    return 'accepted';
  }
}

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();
  private hostBridge: HarmonyHostBridge = new HarmonyHostBridge();

  aboutToAppear(): void {
    webview.WebviewController.setWebDebuggingAccess(BuildProfile.DEBUG);
    const context = this.getUIContext().getHostContext();
    if (context !== undefined) this.hostBridge.setContext(context);
  }

  aboutToDisappear(): void {
    try {
      this.controller.deleteJavaScriptRegister('harmonyHost');
    } catch (error) {
      console.warn(`[HarmonyGateA] bridge cleanup skipped: ${JSON.stringify(error)}`);
    }
  }

  private interceptGameResource(url: string): WebResourceResponse | null {
    if (!url.startsWith(GAME_ORIGIN)) return null;
    const relativeUrl = url.substring(GAME_ORIGIN.length).split(/[?#]/)[0] || 'index.html';
    if (relativeUrl.includes('..')) {
      return this.errorResponse(403, 'Forbidden');
    }

    const response = new WebResourceResponse();
    const headers: Header[] = [
      { headerKey: 'Access-Control-Allow-Origin', headerValue: '*' },
      { headerKey: 'Cache-Control', headerValue: 'no-store' },
    ];
    response.setResponseHeader(headers);
    response.setResponseEncoding('utf-8');
    response.setResponseMimeType(mimeType(relativeUrl));
    response.setResponseCode(200);
    response.setReasonMessage('OK');
    response.setResponseData($rawfile(`game/${relativeUrl}`));
    response.setResponseIsReady(true);
    return response;
  }

  private errorResponse(code: number, message: string): WebResourceResponse {
    const response = new WebResourceResponse();
    response.setResponseData(message);
    response.setResponseEncoding('utf-8');
    response.setResponseMimeType('text/plain');
    response.setResponseCode(code);
    response.setReasonMessage(message);
    return response;
  }

  build() {
    Stack() {
      Web({
        src: `${GAME_ORIGIN}index.html`,
        controller: this.controller,
      })
        .javaScriptAccess(true)
        .domStorageAccess(false)
        .fileAccess(false)
        .javaScriptProxy({
          object: this.hostBridge,
          name: 'harmonyHost',
          methodList: [
            'ping',
            'runtimeInfo',
            'lanStatus',
            'nearbyRooms',
            'createPrototypeRoom',
            'joinPrototypeRoom',
            'connectGameRoom',
            'gameConnectionStatus',
            'drainGameMessages',
            'sendGameMessage',
            'sendGamePeer',
            'setHostedRoomPlayers',
            'closeHostedRoom',
            'startQrScan',
            'qrScanStatus',
            'reportReady',
          ],
          controller: this.controller,
          asyncMethodList: [],
          permission: BRIDGE_PERMISSION,
        })
        .onInterceptRequest((event) => {
          return event ? this.interceptGameResource(event.request.getRequestUrl()) : null;
        })
        .onPageBegin((event) => {
          console.info(`[HarmonyGateA] page begin: ${event?.url ?? 'unknown'}`);
        })
        .onPageEnd((event) => {
          console.info(`[HarmonyGateA] page end: ${event?.url ?? 'unknown'}`);
        })
        .onConsole((event) => {
          if (BuildProfile.DEBUG) console.info(`[HarmonyGateA][Web] ${event.message.getMessage()}`);
          return false;
        })
        .onErrorReceive((event) => {
          if (!event) return;
          console.error(
            `[HarmonyGateA] resource error ${event.error.getErrorCode()}: ` +
              `${event.error.getErrorInfo()} @ ${event.request.getRequestUrl()}`,
          );
        })
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
  }
}

function stringifyError(error: Object): string {
  try {
    return JSON.stringify(error);
  } catch (_) {
    return String(error);
  }
}

function mimeType(path: string): string {
  const extension = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
  switch (extension) {
    case 'html':
      return 'text/html';
    case 'css':
      return 'text/css';
    case 'js':
      return 'application/javascript';
    case 'json':
    case 'map':
      return 'application/json';
    case 'gltf':
      return 'model/gltf+json';
    case 'glb':
      return 'model/gltf-binary';
    case 'png':
      return 'image/png';
    case 'mp3':
      return 'audio/mpeg';
    default:
      return 'application/octet-stream';
  }
}
