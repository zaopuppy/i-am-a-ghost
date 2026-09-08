import { expect, test } from '@playwright/test';

test('solo keeps the debug panel and applies lobby, live and restart tuning', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('debug-panel')).toBeVisible();
  await page.getByRole('button', { name: '移动（单人 / 联机房主）' }).click();
  const speed = page.locator('.lil-gui .lil-controller').filter({ hasText: '鬼速度' }).locator('input');
  await speed.fill('2');
  await speed.press('Enter');
  await page.getByRole('button', { name: '单人游戏', exact: true }).click();
  await expect(page.locator('#solo-start')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#solo-child-count').selectOption('1');
  await page.locator('#solo-start').click();
  await expect(page.getByTestId('debug-panel')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.tuning.ghostMoveSpeed)).toBe(2);
  await speed.fill('6');
  await speed.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.tuning.ghostMoveSpeed)).toBe(6);
  await page.getByRole('button', { name: '感应与手电（单人 / 联机房主）' }).click();
  const length = page.locator('.lil-gui .lil-controller').filter({ hasText: '手电距离' }).locator('input');
  await length.fill('2.5');
  await length.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.tuning.flashlightLength)).toBe(2.5);
  await page.locator('#solo-pause').click();
  await page.locator('#solo-restart').click();
  await expect(page.getByTestId('debug-panel')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.tuning.ghostMoveSpeed)).toBe(6);
});

