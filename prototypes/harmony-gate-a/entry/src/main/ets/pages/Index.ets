import { webview } from '@kit.ArkWeb';
import { lanHostProbe } from '../network/LanHostProbe';

const BRIDGE_PERMISSION = '{"javascriptProxyPermission":{"urlPermissionList":' +
  '[{"scheme":"https","host":"game.local","port":"","path":""}]}}';
const GAME_ORIGIN = 'https://game.local/';

class HarmonyHostBridge {
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
    webview.WebviewController.setWebDebuggingAccess(true);
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
        .domStorageAccess(true)
        .fileAccess(true)
        .javaScriptProxy({
          object: this.hostBridge,
          name: 'harmonyHost',
          methodList: ['ping', 'runtimeInfo', 'lanStatus', 'reportReady'],
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
          console.info(`[HarmonyGateA][Web] ${event.message.getMessage()}`);
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
