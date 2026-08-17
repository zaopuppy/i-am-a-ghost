import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

test('M0 foundation renders a nonblank canvas and reaches the room service', async ({ page, request }) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  const healthResponse = await request.get('/healthz');
  expect(healthResponse.ok()).toBe(true);
  await expect(healthResponse.json()).resolves.toMatchObject({
    ok: true,
    game: 'i-am-a-ghost',
    phase: 'foundation',
  });

  await page.goto('/');
  await expect(page).toHaveTitle('I Am a Ghost');
  await expect(page.getByTestId('network-status')).toHaveText('局域网房间服务已连接');

  await expect
    .poll(() =>
      page.evaluate(() => {
        const diagnostics = window.__THREE_GAME_DIAGNOSTICS__;
        return Boolean(diagnostics && diagnostics.frame > 10 && diagnostics.networkConnected);
      }),
    )
    .toBe(true);

  const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  expect(diagnostics?.frame).toBeGreaterThan(10);
  expect(diagnostics?.renderer.calls).toBeGreaterThan(0);
  expect(diagnostics?.renderer.triangles).toBeGreaterThan(0);

  const canvas = page.locator('#game-canvas');
  const bounds = await canvas.boundingBox();
  expect(bounds?.width).toBeGreaterThan(900);
  expect(bounds?.height).toBeGreaterThan(600);

  const png = PNG.sync.read(await canvas.screenshot());
  let minLuma = 255;
  let maxLuma = 0;
  for (let index = 0; index < png.data.length; index += 4 * 97) {
    const luma = Math.round(
      png.data[index] * 0.2126 + png.data[index + 1] * 0.7152 + png.data[index + 2] * 0.0722,
    );
    minLuma = Math.min(minLuma, luma);
    maxLuma = Math.max(maxLuma, luma);
  }
  expect(maxLuma - minLuma).toBeGreaterThan(20);
  expect(browserErrors).toEqual([]);
});
