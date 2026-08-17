import { expect, test } from '@playwright/test';

test('failed GLB requests keep the procedural house fallback playable', async ({ page }) => {
  await page.route('**/*.glb', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByTestId('network-status')).toHaveText('局域网房间服务已连接');
  await expect
    .poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.assets.wall.status))
    .toBe('failed');
  const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  expect(diagnostics?.renderer.calls).toBeGreaterThan(10);
  expect(diagnostics?.world.walls).toBe(22);
});
