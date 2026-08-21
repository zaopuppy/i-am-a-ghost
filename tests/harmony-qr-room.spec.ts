import { expect, test } from '@playwright/test';

test('Harmony create-room opens a native probe QR instead of waiting for Socket.IO', async ({ page }) => {
  await page.addInitScript(() => {
    const room = {
      ok: true,
      roomCode: 'GHOST7',
      instanceId: 'gate-a-test',
      host: '192.168.8.12',
      port: 34567,
      payload: 'iamaghost://gate-a/join?v=1&instance=gate-a-test&room=GHOST7&host=192.168.8.12&port=34567',
      error: null,
    };
    Object.defineProperty(window, 'harmonyHost', {
      value: {
        ping: (message: string) => `pong:${message}`,
        runtimeInfo: () => '{"platform":"HarmonyOS","prototype":"gate-a","bridgeVersion":1}',
        lanStatus: () => '{"listening":true,"port":34567,"mdnsRegistered":true}',
        nearbyRooms: () => '[]',
        createPrototypeRoom: () => JSON.stringify(room),
        startQrScan: () => '{"started":true}',
        qrScanStatus: () => '{"state":"idle","payload":null,"error":null}',
        joinPrototypeRoom: () => '{"accepted":true}',
        reportReady: () => 'accepted',
      },
    });
  });
  await page.goto('/');

  await page.getByTestId('create-room').click();

  const panel = page.locator('[data-harmony-qr-room]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-harmony-qr-code]')).toHaveText('GHOST7');
  await expect(panel.locator('canvas')).toBeVisible();
  await expect(page.getByTestId('network-status')).toHaveText('二维码探针房间已创建');
});

test('Harmony QR scan parses the probe endpoint and reports native TCP reachability', async ({ page }) => {
  await page.addInitScript(() => {
    let joined = false;
    Object.defineProperty(window, 'harmonyHost', {
      value: {
        ping: (message: string) => `pong:${message}`,
        runtimeInfo: () => '{"platform":"HarmonyOS","prototype":"gate-a","bridgeVersion":1}',
        lanStatus: () => '{"listening":true,"port":45678,"mdnsRegistered":true}',
        nearbyRooms: () => joined
          ? '[{"serviceName":"QR GHOST7","host":"192.168.8.12","port":34567,"state":"reachable","receivedBytes":48}]'
          : '[]',
        createPrototypeRoom: () => '{"ok":false,"error":"unused"}',
        startQrScan: () => '{"started":true}',
        qrScanStatus: () => JSON.stringify({
          state: 'success',
          payload: 'iamaghost://gate-a/join?v=1&instance=gate-a-test&room=GHOST7&host=192.168.8.12&port=34567',
          error: null,
        }),
        joinPrototypeRoom: (host: string, port: number, roomCode: string, instanceId: string) => {
          (window as Window & { __QR_JOIN__?: unknown }).__QR_JOIN__ = { host, port, roomCode, instanceId };
          joined = true;
          return '{"accepted":true,"serviceName":"QR GHOST7","error":null}';
        },
        reportReady: () => 'accepted',
      },
    });
  });
  await page.goto('/');

  await page.locator('[data-harmony-scan-qr]').click();

  await expect(page.getByTestId('network-status')).toHaveText('二维码直连成功');
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __QR_JOIN__?: unknown }
  ).__QR_JOIN__)).toEqual({
    host: '192.168.8.12',
    port: 34567,
    roomCode: 'GHOST7',
    instanceId: 'gate-a-test',
  });
});
