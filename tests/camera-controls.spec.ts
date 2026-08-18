import { expect, test } from '@playwright/test';

test('the map-centered camera keeps mouse orbit, pan, and zoom behind a toggle button', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page.getByTestId('debug-panel')).toBeVisible();
  await page.evaluate(() => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    if (!hooks) throw new Error('Deterministic test hooks are missing.');
    hooks.seed(71);
    hooks.setState('ghost-playing');
    hooks.setPausedForScreenshot(true);
    hooks.setReducedMotion(true);
  });
  await page.waitForFunction(() => {
    const diagnostics = window.__THREE_GAME_DIAGNOSTICS__;
    return diagnostics?.deterministicState === 'ghost-playing'
      && diagnostics.camera.mode === 'whole-house'
      && diagnostics.world.assets.ghost.status === 'ready';
  });

  await expect(page.locator('.lil-gui .lil-controller').filter({ hasText: '编辑 / 预览' })).toHaveCount(0);
  await expect(page.locator('.lil-gui .lil-controller').filter({ hasText: '鼠标操作' })).toHaveCount(0);

  const cameraToggle = page
    .locator('.lil-gui .lil-controller')
    .filter({ hasText: '进入鼠标调镜头' })
    .locator('button');
  await expect(cameraToggle).toBeVisible();
  await cameraToggle.click();
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.camera.pointerMode === true);

  const before = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.cameraSnapshot());
  expect(before?.mode).toBe('whole-house');
  expect(before?.pointerMode).toBe(true);
  expect(before?.target).toEqual({ x: 0, y: 0, z: 0 });

  const canvas = page.locator('#game-canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Game canvas has no layout bounds.');
  const startX = bounds.x + bounds.width * 0.38;
  const startY = bounds.y + bounds.height * 0.62;
  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(startX + 150, startY - 85, { steps: 8 });
  await page.mouse.up({ button: 'left' });
  await page.mouse.wheel(0, -480);

  await page.waitForFunction((previousPosition) => {
    const current = window.__THREE_GAME_TEST_HOOKS__?.cameraSnapshot();
    if (!current) return false;
    return Math.hypot(
      current.position.x - previousPosition.x,
      current.position.y - previousPosition.y,
      current.position.z - previousPosition.z,
    ) > 0.25;
  }, before?.position);
  await page.waitForTimeout(800);
  const orbited = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.cameraSnapshot());
  expect(orbited?.pointerMode).toBe(true);
  expect(orbited?.position).not.toEqual(before?.position);
  expect(orbited?.viewHeight).not.toBe(before?.viewHeight);
  expect(orbited?.tiltDegrees).not.toBe(before?.tiltDegrees);
  expect(orbited?.azimuthDegrees).not.toBe(before?.azimuthDegrees);
  expectCameraValuesAreFinite(orbited);

  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(startX - 90, startY + 55, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  await page.waitForFunction((previousTarget) => {
    const current = window.__THREE_GAME_TEST_HOOKS__?.cameraSnapshot();
    if (!current) return false;
    return Math.hypot(
      current.target.x - previousTarget.x,
      current.target.y - previousTarget.y,
      current.target.z - previousTarget.z,
    ) > 0.1;
  }, orbited?.target);
  const edited = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.cameraSnapshot());
  expect(edited?.target).not.toEqual(orbited?.target);
  expect(Math.abs((edited?.tiltDegrees ?? 0) - (orbited?.tiltDegrees ?? 0))).toBeLessThan(0.5);
  expect(Math.abs((edited?.azimuthDegrees ?? 0) - (orbited?.azimuthDegrees ?? 0))).toBeLessThan(0.5);
  expectCameraValuesAreFinite(edited);

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('capture'));
  await page.waitForFunction(() => {
    const camera = window.__THREE_GAME_DIAGNOSTICS__?.camera;
    return camera?.mode === 'whole-house' && camera.pointerMode === true;
  });
  const capture = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  expect(capture?.cameraMode).toBe('whole-house');
  expect(capture?.camera.pointerMode).toBe(true);
  expectCameraValuesAreFinite(capture?.camera);

  const cameraToggleOff = page
    .locator('.lil-gui .lil-controller')
    .filter({ hasText: '退出鼠标调镜头' })
    .locator('button');
  await cameraToggleOff.click();
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.camera.pointerMode === false);
  const saved = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  expect(saved?.camera.mode).toBe('whole-house');
  expect(saved?.camera.relativePosition).toEqual(saved?.tuning.cameraPresets['whole-house'].position);
  expect(saved?.camera.relativeTarget).toEqual(saved?.tuning.cameraPresets['whole-house'].target);
  expect(saved?.camera.viewHeight).toBe(saved?.tuning.cameraPresets['whole-house'].viewHeight);
  expectCameraValuesAreFinite(saved?.camera);
  expect(errors).toEqual([]);
});

function expectCameraValuesAreFinite(
  camera: {
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
    viewHeight: number;
    distance: number;
    tiltDegrees: number;
    azimuthDegrees: number;
  } | undefined,
): void {
  expect(camera).toBeDefined();
  expect([
    camera?.position.x,
    camera?.position.y,
    camera?.position.z,
    camera?.target.x,
    camera?.target.y,
    camera?.target.z,
    camera?.viewHeight,
    camera?.distance,
    camera?.tiltDegrees,
    camera?.azimuthDegrees,
  ].every((value) => Number.isFinite(value))).toBe(true);
}
