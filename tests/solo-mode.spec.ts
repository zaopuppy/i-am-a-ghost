import { expect, test, type Page } from '@playwright/test';

async function openSolo(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  if (await page.locator('#opening-skip').isVisible()) await page.locator('#opening-skip').click();
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.hideDebugUi(true));
  await page.getByRole('button', { name: '单人游戏', exact: true }).click();
  await expect(page.locator('#solo-start')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#solo-status')).toContainText('断网也能开始');
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.pendingAssetUpgrades)).toBe(0);
}

async function sample(page: Page) {
  return page.evaluate(() => {
    const data = window.__THREE_GAME_DIAGNOSTICS__!;
    return { tick: data.serverTick!, position: data.ownPosition, frame: data.viewerFrame };
  });
}

test('loaded solo works offline: both roles, movement, pause, background, restart and home', async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSolo(page);
  await expect(page.locator('#solo-child-count')).toHaveValue('4');
  await page.screenshot({ path: testInfo.outputPath('solo-setup-desktop.png') });
  await context.setOffline(true);
  await page.locator('#solo-start').click();
  await expect(page.locator('#role-label')).toHaveText('单人 · 你是鬼');
  await expect.poll(async () => (await sample(page)).frame?.children.length).toBe(4);
  const before = (await sample(page)).position!;
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await sample(page)).position?.x).toBeGreaterThan(before.x + 0.3);
  await page.keyboard.up('KeyD');
  await page.keyboard.press('Escape');
  await expect(page.locator('#solo-dialog')).toHaveAttribute('data-screen', 'paused');
  const paused = await sample(page);
  await page.waitForTimeout(350);
  expect(await sample(page)).toEqual(paused);
  await page.screenshot({ path: testInfo.outputPath('solo-paused-desktop.png') });
  await page.locator('#solo-resume').click();
  await expect.poll(async () => (await sample(page)).tick).toBeGreaterThan(paused.tick);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#solo-dialog')).toHaveAttribute('data-screen', 'paused');
  await page.locator('#solo-restart').click();
  await expect(page.locator('#solo-dialog')).not.toBeVisible();
  await expect(page.locator('#match-timer')).toHaveText('05:00');
  await page.locator('#solo-pause').click();
  await page.locator('#solo-change-role').click();
  await expect(page.locator('#solo-start')).toBeEnabled();
  await page.locator('[data-solo-role="child"]').click();
  await page.locator('#solo-child-count').selectOption('1');
  await page.locator('#solo-start').click();
  await expect(page.locator('#role-label')).toHaveText('单人 · 你是小孩');
  await expect.poll(async () => (await sample(page)).frame?.children.length).toBe(1);
  await expect.poll(async () => (await sample(page)).frame?.dolls.length).toBe(3);
  // Idle human loses through the normal capture/reset rules; no fixture changes authority.
  await expect(page.locator('#solo-dialog')).toHaveAttribute('data-screen', 'ended', { timeout: 50_000 });
  await expect(page.locator('#solo-title')).toHaveText('这次输了');
  await page.screenshot({ path: testInfo.outputPath('solo-result-desktop.png') });
  await page.locator('#solo-restart').click();
  await expect(page.locator('#match-timer')).toHaveText('05:00');
  await page.locator('#solo-pause').click();
  await page.locator('#solo-home').click();
  await expect(page.getByTestId('lobby-panel')).toBeVisible();
  await context.setOffline(false);
  await expect(page.locator('#network-status')).toContainText('已连接');
  expect(errors).toEqual([]);
});

test('solo setup and touch controls fit a narrow phone', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await openSolo(page);
    await page.locator('[data-solo-role="child"]').click();
    await page.screenshot({ path: testInfo.outputPath('solo-setup-mobile.png') });
    const bounds = await page.locator('#solo-dialog').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    await page.locator('#solo-start').click();
    await expect(page.locator('#touch-controls')).toBeVisible();
    await page.locator('#solo-pause').click();
    await expect(page.locator('#touch-controls')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('solo-paused-mobile.png') });
    await page.locator('#solo-resume').click();
    await expect(page.locator('#touch-controls')).toBeVisible();
  } finally {
    await context.close();
  }
});
