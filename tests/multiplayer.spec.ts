import { expect, test, type Page } from '@playwright/test';

test('two browser pages join, start, and move through the authoritative input path', async ({ context }) => {
  test.setTimeout(120_000);
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
  await expect(host.getByTestId('start-match')).toBeDisabled();
  await expect(host.getByTestId('start-requirements')).toContainText('还有 2 人未选择阵营');
  await selectLobbyRole(host, 'ghost');
  await selectLobbyRole(guest, 'child');
  await expect(host.getByTestId('lobby-role-picker').locator('[data-role-choice="ghost"]'))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(guest.getByTestId('lobby-role-picker').locator('[data-role-choice="child"]'))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(host.getByTestId('roster').locator('[data-role="ghost"]')).toHaveCount(1);
  await expect(host.getByTestId('roster').locator('[data-role="child"]')).toHaveCount(1);
  await expect(guest.getByTestId('roster').locator('[data-role="ghost"]')).toHaveCount(1);
  await expect(host.getByTestId('start-requirements')).toHaveText('阵营已确认，可以开始游戏。');
  await expect(host.getByTestId('start-match')).toBeEnabled();
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
  await expect(host.getByTestId('match-loading')).toBeVisible();
  await expect(guest.getByTestId('match-loading')).toBeVisible();
  await expect(host.getByTestId('match-timer')).toBeHidden();
  await expect(host.getByTestId('debug-panel')).toBeHidden();
  await expect(host.getByTestId('match-loading')).toBeHidden({ timeout: 45_000 });
  await expect(guest.getByTestId('match-loading')).toBeHidden({ timeout: 45_000 });

  await expect.poll(() => readRole(host), { timeout: 10_000 }).toBe('ghost');
  await expect.poll(() => readRole(guest), { timeout: 10_000 }).toBe('child');
  const childPage = guest;
  const ghostPage = host;
  await expect(childPage.getByTestId('role-label')).toContainText('小孩');
  await expect(ghostPage.getByTestId('role-label')).toContainText('鬼');
  await expect(childPage.getByTestId('match-timer')).toHaveText(/^0[45]:[0-5]\d$/);
  await expect
    .poll(() => childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.cameraMode))
    .toBe('follow');
  await expect
    .poll(() => ghostPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.cameraMode))
    .toBe('follow');
  await expect(ghostPage.locator('#control-hint')).toContainText('持续接触孩子完成抓捕');
  await expect(childPage.locator('#control-hint')).toContainText('WASD 或方向键移动');
  await expect(childPage.locator('#control-hint')).toContainText('鼠标转向');
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
  const infiniteGhostHealth = host
    .locator('.lil-gui .lil-controller')
    .filter({ hasText: '鬼生命无限' })
    .locator('button');
  const infiniteFlashlightEnergy = host
    .locator('.lil-gui .lil-controller')
    .filter({ hasText: '手电能源无限' })
    .locator('button');
  await infiniteGhostHealth.click();
  await infiniteFlashlightEnergy.click();
  await expect
    .poll(() => guest.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.tuning.infiniteGhostHealth))
    .toBe(true);
  await expect
    .poll(() => guest.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.tuning.infiniteFlashlightEnergy))
    .toBe(true);
  await infiniteGhostHealth.click();
  await infiniteFlashlightEnergy.click();
  await expect
    .poll(() => guest.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.tuning.infiniteGhostHealth))
    .toBe(false);
  await expect
    .poll(() => guest.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.tuning.infiniteFlashlightEnergy))
    .toBe(false);
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
  await host.locator('#audio-toggle').click();
  await host.locator('#audio-toggle').click();
  await expect
    .poll(
      () => host.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio.loaded ?? 0),
      { timeout: 15_000 },
    )
    .toBe(9);
  expect(await host.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio.failed)).toBe(0);
  const childFrame = await childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.viewerFrame);
  expect(childFrame?.viewerRole).toBe('child');
  if (childFrame?.viewerRole === 'child') expect(childFrame.ghost).toBeUndefined();

  await childPage.mouse.move(100, 360);
  await expect.poll(async () => Math.cos((await readOwnChildFacing(childPage)) ?? 0)).toBeLessThan(-0.5);
  await childPage.mouse.move(880, 360);
  await expect.poll(async () => Math.cos((await readOwnChildFacing(childPage)) ?? 0)).toBeGreaterThan(0.5);
  await childPage.mouse.move(-10, -10);
  const facingBeforeMovement = await readOwnChildFacing(childPage);
  await childPage.keyboard.down('w');
  await childPage.waitForTimeout(200);
  await childPage.keyboard.up('w');
  expect(await readOwnChildFacing(childPage)).toBeCloseTo(facingBeforeMovement ?? 0, 5);

  const initialX = await childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.ownPosition?.x ?? null);
  expect(initialX).not.toBeNull();
  await childPage.keyboard.down('d');
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
  await childPage.keyboard.up('d');

  const batteryBefore = await childPage.evaluate(() => {
    const frame = window.__THREE_GAME_DIAGNOSTICS__?.viewerFrame;
    return frame?.viewerRole === 'child' ? frame.ownBattery : null;
  });
  await childPage.keyboard.down(' ');
  await expect
    .poll(() => childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.beams ?? 0))
    .toBe(1);
  const litMovementStartX = await childPage.evaluate(
    () => window.__THREE_GAME_DIAGNOSTICS__?.ownPosition?.x ?? null,
  );
  expect(litMovementStartX).not.toBeNull();
  await childPage.keyboard.down('d');
  await expect
    .poll(() => childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.ownPosition?.x ?? null))
    .toBeGreaterThan((litMovementStartX ?? 0) + 0.1);
  await expect
    .poll(() => childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.beams ?? 0))
    .toBe(1);
  const movingFlashlightFrame = await childPage.locator('#game-canvas').screenshot();
  await childPage.keyboard.up('d');
  await expect
    .poll(() => childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.beams ?? 0))
    .toBe(1);
  await childPage.waitForTimeout(160);
  await childPage.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect
    .poll(() => childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.beams ?? 0))
    .toBe(0);
  const unlitFlashlightFrame = await childPage.locator('#game-canvas').screenshot();
  const { PNG } = await import('pngjs');
  const movingImage = PNG.sync.read(movingFlashlightFrame);
  const unlitImage = PNG.sync.read(unlitFlashlightFrame);
  const coneBounds = {
    minX: Math.floor(movingImage.width * 0.48),
    maxX: Math.floor(movingImage.width * 0.73),
    minY: Math.floor(movingImage.height * 0.25),
    maxY: Math.floor(movingImage.height * 0.68),
  };
  await test.info().attach('moving-flashlight.png', {
    body: movingFlashlightFrame,
    contentType: 'image/png',
  });
  const litConePixelRatio = warmPixelRatio(movingImage, coneBounds);
  const unlitConePixelRatio = warmPixelRatio(unlitImage, coneBounds);
  expect(
    litConePixelRatio - unlitConePixelRatio,
    `moving flashlight cone-pixel delta: ${litConePixelRatio - unlitConePixelRatio}`,
  ).toBeGreaterThan(0.01);
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

  const ghostPlayerId = await ghostPage.evaluate(() => {
    const frame = window.__THREE_GAME_DIAGNOSTICS__?.viewerFrame;
    return frame?.viewerPlayerId ?? null;
  });
  expect(ghostPlayerId).not.toBeNull();
  const ghostRosterEntry = childPage.getByTestId('roster').locator(`[data-player-id="${ghostPlayerId}"]`);
  const childRosterBeforeGhostReload = await childPage.evaluate(() => {
    const frame = window.__THREE_GAME_DIAGNOSTICS__?.viewerFrame;
    return frame?.viewerRole === 'child'
      ? { children: frame.children.length, dolls: frame.dolls.length }
      : null;
  });
  const timerBeforeGhostReload = await childPage.getByTestId('match-timer').textContent();
  const ghostReload = ghostPage.reload({ waitUntil: 'domcontentloaded' });
  await expect(ghostRosterEntry.locator('.roster__status')).toHaveAttribute(
    'aria-label',
    '离线，角色仍留在本局',
  );
  expect(await readRole(childPage)).toBe('child');
  await expect.poll(() => childPage.getByTestId('match-timer').textContent())
    .not.toBe(timerBeforeGhostReload);
  expect(await childPage.evaluate(() => {
    const frame = window.__THREE_GAME_DIAGNOSTICS__?.viewerFrame;
    return frame?.viewerRole === 'child'
      ? { children: frame.children.length, dolls: frame.dolls.length }
      : null;
  })).toEqual(childRosterBeforeGhostReload);
  await ghostReload;
  await expect.poll(() => readRole(ghostPage), { timeout: 10_000 }).toBe('ghost');
  expect(await ghostPage.evaluate(() => (
    window.__THREE_GAME_DIAGNOSTICS__?.viewerFrame?.viewerPlayerId ?? null
  ))).toBe(ghostPlayerId);
  await expect(ghostRosterEntry.locator('.roster__status')).toHaveAttribute('aria-label', '在线');
  await expect(childPage.getByTestId('lobby-panel')).toBeHidden();

  expect(errors).toEqual([]);
});

test('simultaneous ghost claims leave one public winner and a recoverable loser', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto('/'), second.goto('/')]);
  await first.getByTestId('create-room').click();
  const roomCode = (await first.getByTestId('room-code').textContent())?.trim() ?? '';
  await second.getByTestId('room-code-input').fill(roomCode);
  await second.getByTestId('join-room').click();
  await expect(first.getByTestId('roster').locator('li')).toHaveCount(2);

  await Promise.all([
    first.getByTestId('lobby-role-picker').locator('[data-role-choice="ghost"]').dispatchEvent('click'),
    second.getByTestId('lobby-role-picker').locator('[data-role-choice="ghost"]').dispatchEvent('click'),
  ]);
  await expect.poll(async () => Promise.all([
    first.getByTestId('roster').locator('[data-role="ghost"]').count(),
    second.getByTestId('roster').locator('[data-role="ghost"]').count(),
  ])).toEqual([1, 1]);
  const firstSelected = await first.getByTestId('lobby-role-picker')
    .locator('[data-role-choice="ghost"]')
    .getAttribute('aria-pressed');
  const loser = firstSelected === 'true' ? second : first;
  await expect(loser.locator('#error-message')).toContainText('鬼阵营已经被其他玩家选择');
  await selectLobbyRole(loser, 'child');
  await expect(first.getByTestId('roster').locator('[data-role="ghost"]')).toHaveCount(1);
  await expect(first.getByTestId('roster').locator('[data-role="child"]')).toHaveCount(1);
  await expect(first.getByTestId('start-match')).toBeEnabled();
});

function readRole(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.role ?? null);
}

async function selectLobbyRole(page: Page, role: 'ghost' | 'child'): Promise<void> {
  const choice = page.getByTestId('lobby-role-picker').locator(`[data-role-choice="${role}"]`);
  await choice.click();
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
}

function readOwnChildFacing(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const frame = window.__THREE_GAME_DIAGNOSTICS__?.viewerFrame;
    if (frame?.viewerRole !== 'child') return null;
    return frame.children.find((child) => child.playerId === frame.viewerPlayerId)?.facingRadians ?? null;
  });
}

function warmPixelRatio(
  image: { width: number; height: number; data: Buffer },
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): number {
  let warmPixels = 0;
  let area = 0;
  for (let y = bounds.minY; y < bounds.maxY; y += 1) {
    for (let x = bounds.minX; x < bounds.maxX; x += 1) {
      const offset = (y * image.width + x) * 4;
      const red = image.data[offset];
      const green = image.data[offset + 1];
      const blue = image.data[offset + 2];
      const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      if (red > blue * 1.35 && green > blue * 1.2 && luma > 55) warmPixels += 1;
      area += 1;
    }
  }
  return warmPixels / area;
}

function collectErrors(page: Page, errors: string[]): void {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
}
