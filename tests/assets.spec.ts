import { expect, test } from '@playwright/test';

test('the house keeps box-wall collision and loads grounded room furniture', async ({ page }) => {
  let wallRequests = 0;
  await page.route('**/wall_straight.glb', (route) => {
    wallRequests += 1;
    void route.abort();
  });
  await page.goto('/?testState=child-playing');
  await page.waitForFunction(() => {
    const diagnostics = window.__THREE_GAME_DIAGNOSTICS__;
    return diagnostics
      && diagnostics.frame > 10
      && diagnostics.world.assets.furniture.status === 'ready'
      && diagnostics.world.environmentProps === 34;
  });
  const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  expect(wallRequests).toBe(0);
  expect(diagnostics?.renderer.calls).toBeGreaterThan(0);
  expect(diagnostics?.world.walls).toBe(22);
  expect(diagnostics?.world.wallDressings).toBe(0);
  expect(diagnostics?.world.environmentProps).toBe(34);
  expect(diagnostics?.world.assets.furniture).toMatchObject({
    status: 'ready',
    triangles: 6_098,
    meshes: 17,
    materials: 3,
    textures: 1,
  });
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
      && diagnostics.world.assets.kid.status === 'ready';
  });

  const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  expect(diagnostics?.world.assets.ghost.status).toBe('failed');
  expect(diagnostics?.world.actors).toBe(5);
  expect(diagnostics?.world.animatedActors).toBe(4);
  expect(diagnostics?.renderer.calls).toBeGreaterThan(0);
  expect(diagnostics?.renderer.triangles).toBeGreaterThan(1_000);
  expect((await page.locator('#game-canvas').screenshot()).byteLength).toBeGreaterThan(10_000);
  expect(errors.filter((message) => !/Failed to load resource: net::ERR_FAILED/.test(message))).toEqual([]);
});
