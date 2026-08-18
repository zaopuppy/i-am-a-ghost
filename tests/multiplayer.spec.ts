import { expect, test, type Page } from '@playwright/test';

test('two browser pages join, start, and move through the authoritative input path', async ({ context }) => {
  const host = await context.newPage();
  const guest = await context.newPage();
  const errors: string[] = [];
  collectErrors(host, errors);
  collectErrors(guest, errors);

  await Promise.all([host.goto('/'), guest.goto('/')]);
  await host.getByTestId('create-room').click();
  await expect(host.getByTestId('room-code')).not.toHaveText('——');
  const roomCode = (await host.getByTestId('room-code').textContent())?.trim() ?? '';
  expect(roomCode).toMatch(/^[A-Z2-9]{6}$/);

  await guest.getByTestId('room-code-input').fill(roomCode);
  await guest.getByTestId('join-room').click();
  await expect(host.getByTestId('roster').locator('li')).toHaveCount(2);
  await expect(guest.getByTestId('roster').locator('li')).toHaveCount(2);
  await host.getByRole('button', { name: '房间移动（房主）' }).click();
  const childSpeedInput = host
    .locator('.lil-gui .lil-controller')
    .filter({ hasText: '小孩速度' })
    .locator('input');
  await expect(childSpeedInput).toBeVisible();
  await childSpeedInput.fill('5.25');
  await childSpeedInput.press('Enter');
  await expect
    .poll(() => guest.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.tuning.childMoveSpeed ?? 0))
    .toBe(5.25);
  await host.getByRole('button', { name: '房间移动（房主）' }).click();
  await host.getByTestId('start-match').click();

  await expect
    .poll(async () => Promise.all([readRole(host), readRole(guest)]))
    .toEqual(expect.arrayContaining(['ghost', 'child']));
  const hostRole = await readRole(host);
  const childPage = hostRole === 'child' ? host : guest;
  const ghostPage = hostRole === 'ghost' ? host : guest;
  await expect(childPage.getByTestId('role-label')).toContainText('小孩');
  await expect(ghostPage.getByTestId('role-label')).toContainText('鬼');
  await expect(childPage.getByTestId('match-timer')).toHaveText(/^0[45]:[0-5]\d$/);
  await expect
    .poll(() => childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.cameraMode))
    .toBe('follow');
  await expect
    .poll(() => ghostPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.cameraMode))
    .toBe('whole-house');
  await expect(ghostPage.locator('#control-hint')).toContainText('接触孩子自动抓取');
  await expect(childPage.locator('#control-hint')).toContainText('ESDF 移动并朝向');
  await expect(childPage.locator('#control-hint')).not.toContainText('鼠标');
  await host.getByRole('button', { name: '感应与手电（房主）' }).click();
  const flashlightLengthInput = host
    .locator('.lil-gui .lil-controller')
    .filter({ hasText: '手电距离' })
    .locator('input');
  await flashlightLengthInput.fill('3.5');
  await flashlightLengthInput.press('Enter');
  await expect
    .poll(
      () => guest.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.tuning.flashlightLength ?? 0),
      { timeout: 2_000 },
    )
    .toBe(3.5);
  await host.getByRole('button', { name: '感应与手电（房主）' }).click();
  await ghostPage.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
  });
  await expect
    .poll(() => ghostPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.input?.actionHeld ?? true))
    .toBe(false);
  const worldMetrics = await ghostPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world);
  expect(worldMetrics).toMatchObject({ rooms: 9, walls: 22, actors: 5 });
  await expect
    .poll(() => ghostPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.assets.kid.status))
    .toBe('ready');
  await expect
    .poll(() => ghostPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.assets.wall.status))
    .toBe('ready');
  await host.locator('#audio-toggle').click();
  await host.locator('#audio-toggle').click();
  await expect
    .poll(
      () => host.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio.loaded ?? 0),
      { timeout: 15_000 },
    )
    .toBe(5);
  expect(await host.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio.failed)).toBe(0);
  const childFrame = await childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.viewerFrame);
  expect(childFrame?.viewerRole).toBe('child');
  if (childFrame?.viewerRole === 'child') expect(childFrame.ghost).toBeUndefined();

  await childPage.keyboard.down('e');
  await expect.poll(() => readOwnChildFacing(childPage)).toBeCloseTo(-Math.PI / 2, 2);
  await childPage.keyboard.up('e');
  const facingBeforePointerMove = await readOwnChildFacing(childPage);
  await childPage.mouse.move(20, 20);
  await childPage.mouse.move(1100, 650);
  await childPage.waitForTimeout(150);
  expect(await readOwnChildFacing(childPage)).toBeCloseTo(facingBeforePointerMove ?? 0, 5);

  const initialX = await childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.ownPosition?.x ?? null);
  expect(initialX).not.toBeNull();
  await childPage.keyboard.down('f');
  await expect
    .poll(async () => childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.ownPosition?.x ?? null))
    .toBeGreaterThan((initialX ?? 0) + 0.1);
  await childPage.evaluate(() => window.dispatchEvent(new Event('blur')));
  const positionAfterBlur = await childPage.evaluate(
    () => window.__THREE_GAME_DIAGNOSTICS__?.ownPosition?.x ?? null,
  );
  await childPage.waitForTimeout(600);
  const settledPosition = await childPage.evaluate(
    () => window.__THREE_GAME_DIAGNOSTICS__?.ownPosition?.x ?? null,
  );
  expect(positionAfterBlur).not.toBeNull();
  expect(settledPosition).not.toBeNull();
  expect(Math.abs((settledPosition ?? 0) - (positionAfterBlur ?? 0))).toBeLessThan(0.25);
  await childPage.keyboard.up('f');

  const batteryBefore = await childPage.evaluate(() => {
    const frame = window.__THREE_GAME_DIAGNOSTICS__?.viewerFrame;
    return frame?.viewerRole === 'child' ? frame.ownBattery : null;
  });
  await childPage.keyboard.down(' ');
  await expect
    .poll(() => childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.beams ?? 0))
    .toBe(1);
  await childPage.waitForTimeout(160);
  await childPage.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect
    .poll(() => childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.beams ?? 0))
    .toBe(0);
  await childPage.keyboard.up(' ');
  const batteryAfter = await childPage.evaluate(() => {
    const frame = window.__THREE_GAME_DIAGNOSTICS__?.viewerFrame;
    return frame?.viewerRole === 'child' ? frame.ownBattery : null;
  });
  expect(batteryAfter).not.toBeNull();
  expect(batteryAfter ?? 1).toBeLessThan(batteryBefore ?? 0);

  const childPlayerId = childFrame?.viewerPlayerId;
  await childPage.reload();
  await expect
    .poll(() => childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.role ?? null))
    .toBe('child');
  const restoredPlayerId = await childPage.evaluate(() => {
    const frame = window.__THREE_GAME_DIAGNOSTICS__?.viewerFrame;
    return frame?.viewerPlayerId ?? null;
  });
  expect(restoredPlayerId).toBe(childPlayerId);
  await expect
    .poll(() => childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.network.reconnecting ?? true))
    .toBe(false);

  await ghostPage.close();
  await expect(childPage.getByTestId('lobby-panel')).toBeVisible();
  await expect(childPage.locator('#error-message')).toContainText('鬼已断线');

  expect(errors).toEqual([]);
});

function readRole(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.role ?? null);
}

function readOwnChildFacing(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const frame = window.__THREE_GAME_DIAGNOSTICS__?.viewerFrame;
    if (frame?.viewerRole !== 'child') return null;
    return frame.children.find((child) => child.playerId === frame.viewerPlayerId)?.facingRadians ?? null;
  });
}

function collectErrors(page: Page, errors: string[]): void {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
}
