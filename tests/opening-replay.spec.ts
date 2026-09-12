import { expect, test } from '@playwright/test';

test('explicit replay plays the animation even when automatic motion is reduced', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('#opening-replay').click();
  await expect(page.locator('#opening')).toHaveAttribute('data-state', 'playing', { timeout: 20_000 });
  await expect(page.locator('#opening')).toHaveAttribute('data-beat', 'paper');
  await page.locator('#opening-skip').click();
  await expect(page.locator('#opening')).toBeHidden();
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`a returning viewer can watch three times from the title at ${viewport.width}px`, async ({ page }, testInfo) => {
    test.setTimeout(70_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByRole('button', { name: '观看开场动画' }).click();
    for (let viewing = 0; viewing < 3; viewing += 1) {
      await expect(page.locator('#opening')).toHaveAttribute('data-state', 'playing', { timeout: 20_000 });
      await expect(page.locator('#opening')).toHaveAttribute('data-beat', 'paper');
      await expect(page.locator('#opening')).toHaveAttribute('data-state', 'title', { timeout: 20_000 });
      const replay = page.getByRole('button', { name: '再看一遍' });
      await expect(replay).toBeVisible();
      const bounds = (await replay.boundingBox())!;
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
      if (viewing < 2) await replay.click();
    }
    await expect(page.locator('#opening-title')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: testInfo.outputPath('repeat-viewing-title.png') });
    await page.keyboard.press('Tab');
    await expect(page.locator('#opening-watch-again')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '观看开场动画' })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('room lobby keeps the replay entry and replay returns to the same room', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('room-code')).toHaveText(/^[A-Z0-9]{6}$/);
  const roomCode = await page.getByTestId('room-code').textContent();
  await expect(page.getByRole('button', { name: '观看开场动画' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('room-replay-entry.png') });
  await page.getByRole('button', { name: '观看开场动画' }).click();
  await expect(page.locator('#opening')).toHaveAttribute('data-state', 'playing', { timeout: 20_000 });
  await page.waitForTimeout(400);
  await expect(page.locator('#opening')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('room-code')).toHaveText(roomCode!);
  await expect(page.getByRole('button', { name: '观看开场动画' })).toBeFocused();
});
