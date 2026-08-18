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

test('a failed Ghost GLB request keeps the procedural ghost fallback playable', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/Ghost.glb', (route) => route.abort());
  await page.goto('/?testState=ghost-playing');

  await page.waitForFunction(() => {
    const diagnostics = window.__THREE_GAME_DIAGNOSTICS__;
    return diagnostics
      && diagnostics.frame > 10
      && diagnostics.world.assets.ghost.status === 'failed'
      && diagnostics.world.assets.kid.status === 'ready'
      && diagnostics.world.assets.wall.status === 'ready';
  });

  const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  expect(diagnostics?.world.assets.ghost.status).toBe('failed');
  expect(diagnostics?.world.actors).toBe(5);
  expect(diagnostics?.world.animatedActors).toBe(4);
  expect(diagnostics?.renderer.calls).toBeGreaterThan(10);
  expect(diagnostics?.renderer.triangles).toBeGreaterThan(1_000);
  expect((await page.locator('#game-canvas').screenshot()).byteLength).toBeGreaterThan(10_000);
  expect(errors.filter((message) => !/Failed to load resource: net::ERR_FAILED/.test(message))).toEqual([]);
});
