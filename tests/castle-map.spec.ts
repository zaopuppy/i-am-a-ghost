import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import castleSource from '../assets/maps/midnight-castle.scene.json' with { type: 'json' };

async function selectCastle(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.evaluate(async () => {
    // Match Vite's current module URL, including its HMR version when present.
    const path = performance.getEntriesByType('resource')
      .filter((entry) => new URL(entry.name).pathname === '/src/game/GameWorld.ts')
      .at(-1)?.name ?? '/src/game/GameWorld.ts';
    const { GameWorld } = await import(path);
    const sync = GameWorld.prototype.sync;
    GameWorld.prototype.sync = function (...args: unknown[]) {
      const result = sync.apply(this, args);
      const world = this;
      Object.assign(window, {
        __castleSceneNames: () => {
          const names: string[] = [];
          world.scene.traverse((object: { name: string }) => names.push(object.name));
          return names;
        },
        __castleMaterialColors: () => {
          const colors: Record<string, { r: number; g: number; b: number }> = {};
          world.scene.getObjectByName('castle-environment')?.traverse((object: {
            material?: { name: string; color?: { r: number; g: number; b: number } }
              | Array<{ name: string; color?: { r: number; g: number; b: number } }>;
          }) => {
            for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
              if (material.color) colors[material.name] = { r: material.color.r, g: material.color.g, b: material.color.b };
            }
          });
          return colors;
        },
        __castleShadowWalls: () => {
          const walls: Array<{ name: string; mask: number; castShadow: boolean; x: number; z: number; width: number; height: number; depth: number }> = [];
          world.scene.traverse((object: {
            name: string; layers: { mask: number }; castShadow: boolean;
            position: { x: number; z: number }; geometry?: { parameters: { width: number; height: number; depth: number } };
          }) => {
            if (!object.name.startsWith('castle-shadow-wall-') && !object.name.startsWith('castle-shadow-boundary-')) return;
            walls.push({ name: object.name, mask: object.layers.mask, castShadow: object.castShadow,
              x: object.position.x, z: object.position.z, ...object.geometry!.parameters });
          });
          return walls;
        },
      });
      return result;
    };
  });
  if (await page.locator('#opening-skip').isVisible()) await page.locator('#opening-skip').click();
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.hideDebugUi(true));
  await page.locator('#solo-game').click();
  await page.locator('#solo-houses [data-house-choice="midnight-castle"]').click();
  await expect(page.locator('#solo-houses [data-house-choice="midnight-castle"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#solo-start')).toBeEnabled({ timeout: 45_000 });
  await page.locator('#solo-start').click();
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.sceneId)).toBe('midnight-castle');
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.ownPosition), { timeout: 30_000 }).not.toBeNull();
}

test('castle selection loads the Blender scene, moves, pauses, restarts and switches back to a stock house', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await selectCastle(page);
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.assets.castle?.status), { timeout: 30_000 }).toBe('ready');
  const world = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.world);
  expect(world.rooms).toBe(7);
  expect(world.assets.castle?.meshes).toBeGreaterThan(30);
  expect(world.assets.castle?.triangles).toBeGreaterThan(1_000);
  expect(world.assets.castle?.fileBytes).toBeGreaterThan(10_000);
  // The refined map must retain authored surface maps through Blender's GLB export.
  expect(world.assets.castle?.textures).toBeGreaterThan(0);
  expect(world.assets.castle?.error).toBeNull();
  const colors = await page.evaluate(() => (window as Window & {
    __castleMaterialColors(): Record<string, { r: number; g: number; b: number }>;
  }).__castleMaterialColors());
  // Neutral shared texture maps must keep the authored oak and wine-red color factors.
  expect(colors.wood.r).toBeGreaterThan(colors.wood.b);
  expect(colors.wine.r).toBeGreaterThan(colors.wine.g);
  const names = await page.evaluate(() => (window as Window & { __castleSceneNames(): string[] }).__castleSceneNames());
  expect(names).toContain('castle-environment');
  for (const stockGroup of ['box-walls', 'room-furniture', 'room-floors', 'house-openings']) {
    expect(names).not.toContain(stockGroup);
  }
  const shadows = await page.evaluate(() => (window as Window & {
    __castleShadowWalls(): Array<{ name: string; mask: number; castShadow: boolean; x: number; z: number; width: number; height: number; depth: number }>;
  }).__castleShadowWalls());
  expect(shadows).toHaveLength(castleSource.walls.length + 4);
  for (const [index, wall] of castleSource.walls.entries()) {
    expect(shadows[index]).toMatchObject({
      mask: 6, castShadow: true, height: 2.8,
      x: (wall.minX + wall.maxX) / 2, z: (wall.minZ + wall.maxZ) / 2,
      width: wall.maxX - wall.minX, depth: wall.maxZ - wall.minZ,
    });
  }
  for (const boundary of shadows.slice(castleSource.walls.length)) {
    expect(boundary).toMatchObject({ mask: 2, castShadow: true, height: 2.8 });
  }
  const start = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.ownPosition!);
  await page.keyboard.down('KeyW');
  await expect.poll(async () => {
    const point = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.ownPosition!);
    return Math.hypot(point.x - start.x, point.z - start.z);
  }).toBeGreaterThan(0.4);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Escape');
  await expect(page.locator('#solo-dialog')).toHaveAttribute('data-screen', 'paused');
  const tick = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.serverTick);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.serverTick)).toBe(tick);
  await page.locator('#solo-restart').click();
  await expect(page.locator('#solo-dialog')).toBeHidden();
  await expect(page.locator('#match-timer')).toHaveText('05:00');
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.assets.castle?.status)).toBe('ready');
  await captureActiveCastle(page, testInfo.outputPath('castle-active-desktop.png'));
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource')
      .filter((entry) => new URL(entry.name).pathname === '/src/core/CameraRig.ts')
      .at(-1)?.name ?? '/src/core/CameraRig.ts';
    const { CameraRig, RECOMMENDED_CAMERA_PRESETS } = await import(path);
    const update = CameraRig.prototype.update;
    CameraRig.prototype.update = function (input: Record<string, unknown>) {
      update.call(this, { ...input, mode: 'whole-house', captureActive: false,
        baseTarget: { x: 0, y: 0, z: 0 },
        preset: { ...RECOMMENDED_CAMERA_PRESETS['whole-house'], viewHeight: 28 }, immediate: true });
    };
    Object.assign(window, { __restoreCastleCamera: () => { CameraRig.prototype.update = update; } });
  });
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.cameraMode)).toBe('whole-house');
  await captureActiveCastle(page, testInfo.outputPath('castle-whole-house.png'));
  const desktopDiagnosticsPath = testInfo.outputPath('castle-desktop-diagnostics.json');
  writeFileSync(desktopDiagnosticsPath, JSON.stringify(await page.evaluate(() => ({
      renderer: window.__THREE_GAME_DIAGNOSTICS__!.renderer,
      world: window.__THREE_GAME_DIAGNOSTICS__!.world,
      viewport: { width: innerWidth, height: innerHeight },
    })), null, 2));
  await testInfo.attach('castle-desktop-diagnostics', { path: desktopDiagnosticsPath, contentType: 'application/json' });
  await page.evaluate(() => (window as Window & { __restoreCastleCamera(): void }).__restoreCastleCamera());
  await page.locator('#solo-pause').click();
  await page.locator('#solo-home').click();
  await page.locator('#solo-game').click();
  await page.locator('#solo-houses [data-house-choice="m3-nine-room-house"]').click();
  await expect(page.locator('#solo-start')).toBeEnabled();
  await page.locator('#solo-start').click();
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.sceneId)).toBe('m3-nine-room-house');
  const stock = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.world);
  expect(stock.assets.castle).toBeNull();
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.environmentProps)).toBe(34);
  expect(errors).toEqual([]);
});

test('the actual ghost walks behind the chapel front pews and through both side aisles', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const draft = structuredClone(castleSource);
  draft.ghostSpawn = { x: -4.8, z: -10.2 };
  await page.addInitScript((scene) => {
    localStorage.setItem('i-am-a-ghost:house-scene-draft:v1', JSON.stringify(scene));
  }, draft);
  await page.goto('/?scenePlaytest=ghost');
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.assets.castle?.status),
    { timeout: 30_000 }).toBe('ready');
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.ownPosition?.x),
    { timeout: 30_000 }).toBeCloseTo(-4.8, 1);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.hideDebugUi(true));

  const walk = async (key: string, axis: 'x' | 'z', target: number, increasing: boolean): Promise<void> => {
    await page.keyboard.down(key);
    try {
      await expect.poll(async () => {
        const point = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.ownPosition!);
        return increasing ? point[axis] >= target : point[axis] <= target;
      }, { timeout: 10_000, intervals: [50] }).toBe(true);
    } finally {
      await page.keyboard.up(key);
    }
  };
  await walk('KeyD', 'x', -1.7, true);
  await walk('KeyS', 'z', -4.9, true);
  await walk('KeyW', 'z', -10.2, false);
  await walk('KeyD', 'x', 4.8, true);
  await walk('KeyA', 'x', 1.7, false);
  await walk('KeyS', 'z', -4.9, true);
  const end = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.ownPosition!);
  expect(end.x).toBeCloseTo(1.7, 0);
  expect(end.z).toBeGreaterThanOrEqual(-4.9);
  await page.screenshot({ path: testInfo.outputPath('chapel-aisles-played.png') });
  expect(errors).toEqual([]);
});

test('a failed castle GLB preserves a playable seven-room fallback', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/midnight-castle.glb', (route) => route.fulfill({ status: 404, body: 'Missing test asset' }));
  await selectCastle(page);
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.assets.castle?.status)).toBe('failed');
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.environmentProps)).toBe(27);
  const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!);
  expect(diagnostics.world.rooms).toBe(7);
  expect(diagnostics.world.assets.castle?.error).toContain('HTTP 404');
  expect(diagnostics.renderer.triangles).toBeGreaterThan(1_000);
  const tick = diagnostics.serverTick!;
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.serverTick)).toBeGreaterThan(tick);
  await captureActiveCastle(page, testInfo.outputPath('castle-fallback-desktop.png'));
  expect(errors).toEqual([]);
});

test('disposing a castle while its GLB request is pending prevents a late scene attachment', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/assets/CastleEnvironment.ts';
    const { CastleEnvironment } = await import(path);
    const environment = new CastleEnvironment();
    const pending = environment.load();
    environment.dispose();
    await pending;
    return { status: environment.diagnostics.status, children: environment.root.children.length };
  });
  expect(result).toEqual({ status: 'disposed', children: 0 });
});

test('castle gameplay fits a phone and touch movement reaches the match', async ({ browser }, testInfo) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ viewport: { width: 707, height: 440 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await selectCastle(page);
    await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.assets.castle?.status), { timeout: 30_000 }).toBe('ready');
    await expect(page.locator('#touch-controls')).toBeVisible();
    const control = page.locator('#touch-move-area');
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    const start = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.ownPosition!);
    const session = await context.newCDPSession(page);
    const finger = { id: 1, x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger] });
    finger.y -= 60;
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [finger] });
    await expect.poll(async () => {
      const point = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.ownPosition!);
      return Math.hypot(point.x - start.x, point.z - start.z);
    }).toBeGreaterThan(0.3);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await captureActiveCastle(page, testInfo.outputPath('castle-active-mobile.png'));
    const mobileDiagnosticsPath = testInfo.outputPath('castle-mobile-diagnostics.json');
    writeFileSync(mobileDiagnosticsPath, JSON.stringify(await page.evaluate(() => ({
        renderer: window.__THREE_GAME_DIAGNOSTICS__!.renderer,
        world: window.__THREE_GAME_DIAGNOSTICS__!.world,
        viewport: { width: innerWidth, height: innerHeight },
      })), null, 2));
    await testInfo.attach('castle-mobile-diagnostics', { path: mobileDiagnosticsPath, contentType: 'application/json' });
    const hud = await page.locator('.m2-hud').boundingBox();
    expect(hud!.x).toBeGreaterThanOrEqual(0);
    expect(hud!.x + hud!.width).toBeLessThanOrEqual(707);
  } finally {
    await context.close();
  }
});

async function captureActiveCastle(page: Page, path: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const hooks = window.__THREE_GAME_TEST_HOOKS__!;
    hooks.seed(71);
    hooks.setReducedMotion(true);
    hooks.hideDebugUi(true);
  });
  const pixels = PNG.sync.read(await page.locator('#game-canvas').screenshot());
  let minimum = 255;
  let maximum = 0;
  for (let index = 0; index < pixels.data.length; index += 4 * 97) {
    const luma = pixels.data[index] * 0.2126 + pixels.data[index + 1] * 0.7152 + pixels.data[index + 2] * 0.0722;
    minimum = Math.min(minimum, luma);
    maximum = Math.max(maximum, luma);
  }
  expect(maximum - minimum).toBeGreaterThan(20);
  await page.screenshot({ path });
}
