import { expect, test } from '@playwright/test';

test('Harmony create-room opens a native QR and enters the local hosted lobby', async ({ page }) => {
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
        connectGameRoom: () => '{"accepted":true}',
        gameConnectionStatus: () => '{"state":"disconnected"}',
        drainGameMessages: () => '[]',
        sendGameMessage: () => '{"accepted":false}',
        sendGamePeer: () => '{"accepted":true}',
        setHostedRoomPlayers: () => '{"accepted":true}',
        closeHostedRoom: () => '{"accepted":true}',
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
  await expect(page.getByTestId('network-status')).toHaveText('已加入房间 GHOST7');
  await expect(page.getByTestId('room-code')).toHaveText('GHOST7');
  await expect(page.getByTestId('roster').locator('li')).toHaveCount(1);
});

test('Harmony QR scan connects and joins the game lobby', async ({ page }) => {
  await page.addInitScript(() => {
    let inbox: Array<{ peerId: string; payload: string }> = [];
    Object.defineProperty(window, 'harmonyHost', {
      value: {
        ping: (message: string) => `pong:${message}`,
        runtimeInfo: () => '{"platform":"HarmonyOS","prototype":"gate-a","bridgeVersion":1}',
        lanStatus: () => '{"listening":true,"port":45678,"mdnsRegistered":true}',
        nearbyRooms: () => '[]',
        createPrototypeRoom: () => '{"ok":false,"error":"unused"}',
        startQrScan: () => '{"started":true}',
        qrScanStatus: () => JSON.stringify({
          state: 'success',
          payload: 'iamaghost://gate-a/join?v=1&instance=gate-a-test&room=GHOST7&host=192.168.8.12&port=34567',
          error: null,
        }),
        joinPrototypeRoom: (host: string, port: number, roomCode: string, instanceId: string) => {
          return '{"accepted":true,"serviceName":"QR GHOST7","error":null}';
        },
        connectGameRoom: (host: string, port: number, roomCode: string, instanceId: string) => {
          (window as Window & { __QR_JOIN__?: unknown }).__QR_JOIN__ = { host, port, roomCode, instanceId };
          return '{"accepted":true}';
        },
        gameConnectionStatus: () => '{"state":"connected"}',
        drainGameMessages: () => {
          const result = JSON.stringify(inbox);
          inbox = [];
          return result;
        },
        sendGameMessage: (payload: string) => {
          const request = JSON.parse(payload) as { type?: string; requestId?: string };
          if (request.type === 'join-room' && typeof request.requestId === 'string') {
            const session = { roomCode: 'GHOST7', playerId: 'remote-1', rejoinToken: 'test', isHost: false };
            const state = {
              roomCode: 'GHOST7',
              phase: 'lobby',
              matchId: null,
              round: 0,
              players: [
                { playerId: 'host-1', nickname: '房主', isHost: true, connected: true, role: null, ready: false },
                { playerId: 'remote-1', nickname: '访客', isHost: false, connected: true, role: null, ready: false },
              ],
              minimumPlayers: 2,
              maximumPlayers: 5,
              notice: null,
              debugGameplayTuning: null,
            };
            inbox.push(
              { peerId: 'host', payload: JSON.stringify({ type: 'room-state', state }) },
              { peerId: 'host', payload: JSON.stringify({ type: 'response', requestId: request.requestId, result: { ok: true, session } }) },
            );
          }
          return '{"accepted":true}';
        },
        sendGamePeer: () => '{"accepted":false}',
        setHostedRoomPlayers: () => '{"accepted":false}',
        closeHostedRoom: () => '{"accepted":true}',
        reportReady: () => 'accepted',
      },
    });
  });
  await page.goto('/');

  await page.locator('[data-harmony-scan-qr]').click();

  await expect(page.getByTestId('network-status')).toHaveText('已加入房间 GHOST7');
  await expect(page.getByTestId('roster').locator('li')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __QR_JOIN__?: unknown }
  ).__QR_JOIN__)).toEqual({
    host: '192.168.8.12',
    port: 34567,
    roomCode: 'GHOST7',
    instanceId: 'gate-a-test',
  });
});

test('Harmony host worker admits a peer and starts authoritative frames', async ({ page }) => {
  await page.addInitScript(() => {
    const room = {
      ok: true,
      roomCode: 'GHOST7',
      instanceId: 'gate-a-host-test',
      host: '192.168.8.12',
      port: 34567,
      payload: 'iamaghost://gate-a/join?v=1&instance=gate-a-host-test&room=GHOST7&host=192.168.8.12&port=34567',
      error: null,
    };
    let inbox: Array<{ peerId: string; payload: string }> = [];
    const peerMessages: string[] = [];
    Object.assign(window, {
      __PUSH_HARMONY_PEER__: (payload: string) => inbox.push({ peerId: 'peer-7', payload }),
      __HARMONY_PEER_MESSAGES__: peerMessages,
    });
    Object.defineProperty(window, 'harmonyHost', {
      value: {
        ping: (message: string) => `pong:${message}`,
        runtimeInfo: () => '{"platform":"HarmonyOS","prototype":"gate-a","bridgeVersion":1}',
        lanStatus: () => '{"listening":true,"port":34567,"mdnsRegistered":true}',
        nearbyRooms: () => '[]',
        createPrototypeRoom: () => JSON.stringify(room),
        joinPrototypeRoom: () => '{"accepted":true}',
        connectGameRoom: () => '{"accepted":true}',
        gameConnectionStatus: () => '{"state":"disconnected"}',
        drainGameMessages: () => {
          const result = JSON.stringify(inbox);
          inbox = [];
          return result;
        },
        sendGameMessage: () => '{"accepted":false}',
        sendGamePeer: (_peerId: string, payload: string) => {
          peerMessages.push(payload);
          return '{"accepted":true}';
        },
        setHostedRoomPlayers: () => '{"accepted":true}',
        closeHostedRoom: () => '{"accepted":true}',
        startQrScan: () => '{"started":true}',
        qrScanStatus: () => '{"state":"idle","payload":null,"error":null}',
        reportReady: () => 'accepted',
      },
    });
  });
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('roster').locator('li')).toHaveCount(1);

  await page.evaluate(() => {
    const push = (window as Window & { __PUSH_HARMONY_PEER__?: (payload: string) => void })
      .__PUSH_HARMONY_PEER__;
    push?.(JSON.stringify({
      type: 'join-room',
      requestId: 'remote-join',
      protocolVersion: 3,
      buildVersion: '0.7.0-art-pass',
      roomCode: 'GHOST7',
      nickname: '远端玩家',
    }));
  });
  await expect(page.getByTestId('roster').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('start-match')).toBeEnabled();

  await page.getByTestId('start-match').click();
  await expect(page.getByTestId('lobby-panel')).toBeHidden();
  await expect(page.getByTestId('role-label')).toContainText(/你是鬼|你是小孩/);
  await expect.poll(() => page.evaluate(() => {
    const messages = (window as Window & { __HARMONY_PEER_MESSAGES__?: string[] })
      .__HARMONY_PEER_MESSAGES__ ?? [];
    return messages.some((payload) => JSON.parse(payload).type === 'match-frame');
  })).toBe(true);
});
