import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

test.use({ storageState: { cookies: [], origins: [] } });

test('first visit plays without input, waits at the title, then enters the lobby', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  // Observe before the load event: model requests can finish after the
  // automatically playing prologue has already left its first shot.
  await page.goto('/', { waitUntil: 'commit' });
  const opening = page.locator('#opening');
  await expect(opening).toHaveAttribute('data-beat', 'paper', { timeout: 20_000 });
  await expect(page.locator('#solo-game')).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('opening-paper-desktop.png') });
  await expect(opening).toHaveAttribute('data-beat', 'shadow', { timeout: 15_000 });
  await page.screenshot({ path: testInfo.outputPath('opening-shadow-desktop.png') });
  await expect(opening).toHaveAttribute('data-state', 'title', { timeout: 20_000 });
  await expect(page.locator('#opening-title')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: testInfo.outputPath('opening-title-desktop.png') });
  const png = PNG.sync.read(await page.locator('#game-canvas').screenshot());
  let lit = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    if (png.data[index] + png.data[index + 1] + png.data[index + 2] > 90) lit += 1;
  }
  expect(lit / (png.width * png.height)).toBeGreaterThan(0.025);
  await testInfo.attach('canvas-pixels', { body: JSON.stringify({ litShare: lit / (png.width * png.height) }), contentType: 'application/json' });
  await testInfo.attach('opening-render-info', { body: (await opening.getAttribute('data-render-info'))!, contentType: 'application/json' });
  await expect(page.locator('#opening-start')).toBeFocused();
  await page.waitForTimeout(400);
  await expect(opening).toBeVisible();
  await expect(page.locator('#game-hud')).toBeHidden();
  await page.locator('#opening-start').click();
  await expect(opening).toBeHidden();
  await expect(page.locator('#solo-game')).toBeFocused();
  await page.reload();
  await expect(page.locator('#solo-game')).toBeVisible();
  await expect(opening).toBeHidden();
  await page.locator('#opening-replay').click();
  await expect(opening).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(opening).toBeHidden();
  expect(errors).toEqual([]);
});

test('skip during asset loading stays dismissed when loading completes', async ({ page }) => {
  await page.route('**/OpeningScene.ts*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });
  await page.goto('/');
  await page.locator('#opening-skip').click();
  await expect(page.locator('#solo-game')).toBeVisible();
  await page.waitForTimeout(1600);
  await expect(page.locator('#opening')).toBeHidden();
  await expect(page.locator('#solo-game')).toBeEnabled();
});

for (const viewport of [{ width: 390, height: 844 }, { width: 707, height: 440 }]) {
  test(`reduced motion title fits ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('#opening')).toHaveAttribute('data-state', 'title', { timeout: 20_000 });
    await page.screenshot({ path: testInfo.outputPath('opening-title-mobile.png') });
    for (const selector of ['#opening-title', '#opening-start']) {
      const bounds = (await page.locator(selector).boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    }
    await page.keyboard.press('Tab');
    await expect(page.locator('#opening-watch-again')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#opening-start')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#solo-game')).toBeVisible();
  });
}

test('room links bypass the prologue', async ({ page }) => {
  await page.goto('/?room=ABC123');
  await expect(page.locator('#room-code-input')).toHaveValue('ABC123');
  await expect(page.locator('#opening')).toBeHidden();
});

test('failed character loading returns to the lobby and can be retried', async ({ page }) => {
  let available = false;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/Rogue_Kid.glb', (route) => available ? route.continue() : route.abort());
  await page.goto('/');
  await expect(page.locator('#solo-game')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#opening')).toBeHidden();
  available = true;
  await page.locator('#opening-replay').click();
  await expect(page.locator('#opening')).toHaveAttribute('data-state', 'title', { timeout: 20_000 });
  await page.locator('#opening-start').click();
  await expect(page.locator('#solo-game')).toBeVisible();
});
