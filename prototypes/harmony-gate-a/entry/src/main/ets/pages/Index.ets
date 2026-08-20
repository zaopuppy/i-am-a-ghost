import { webview } from '@kit.ArkWeb';

const BRIDGE_PERMISSION = '{"javascriptProxyPermission":{"urlPermissionList":' +
  '[{"scheme":"resource","host":"rawfile","port":"","path":"game/"}]}}';

class HarmonyHostBridge {
  ping(message: string): string {
    console.info(`[HarmonyGateA] bridge ping: ${message}`);
    return `pong:${message}`;
  }

  runtimeInfo(): string {
    return '{"platform":"HarmonyOS","prototype":"gate-a","bridgeVersion":1}';
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

  build() {
    Stack() {
      Web({
        src: 'resource://rawfile/game/index.html',
        controller: this.controller,
      })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .fileAccess(true)
        .javaScriptProxy({
          object: this.hostBridge,
          name: 'harmonyHost',
          methodList: ['ping', 'runtimeInfo', 'reportReady'],
          controller: this.controller,
          asyncMethodList: [],
          permission: BRIDGE_PERMISSION,
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
