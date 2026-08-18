import { expect, test } from '@playwright/test';

test('capture close-up overrides mouse camera control and then restores the edited runtime preset', async ({ page }) => {
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

  const presetSelect = page
    .locator('.lil-gui .lil-controller')
    .filter({ hasText: '编辑 / 预览' })
    .locator('select');
  await presetSelect.selectOption({ label: '鬼 · 全屋' });
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.camera.mode === 'whole-house');

  const cameraToggle = page
    .locator('.lil-gui .lil-controller')
    .filter({ hasText: '进入鼠标调镜头' })
    .locator('input');
  await expect(cameraToggle).toBeVisible();
  await cameraToggle.check();
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.camera.pointerMode === true);

  const before = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.cameraSnapshot());
  expect(before?.mode).toBe('whole-house');
  expect(before?.pointerMode).toBe(true);

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
  const edited = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.cameraSnapshot());
  expect(edited?.pointerMode).toBe(true);
  expect(edited?.position).not.toEqual(before?.position);
  expect(edited?.viewHeight).not.toBe(before?.viewHeight);
  expectCameraValuesAreFinite(edited);

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('capture'));
  await page.waitForFunction(() => {
    const camera = window.__THREE_GAME_DIAGNOSTICS__?.camera;
    return camera?.mode === 'capture-closeup' && camera.pointerMode === false;
  });
  const capture = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  const capturePreset = capture?.tuning.cameraPresets['capture-closeup'];
  const savedWholeHousePreset = capture?.tuning.cameraPresets['whole-house'];
  expect(capture?.cameraMode).toBe('capture-closeup');
  expect(capture?.camera.relativePosition).toEqual(capturePreset?.position);
  expect(capture?.camera.relativeTarget).toEqual(capturePreset?.target);
  expect(capture?.camera.viewHeight).toBe(capturePreset?.viewHeight);
  expect(capture?.camera.pointerMode).toBe(false);
  expectCameraValuesAreFinite(capture?.camera);

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('ghost-playing'));
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.camera.mode === 'whole-house');
  const restored = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.camera);
  expect(restored?.pointerMode).toBe(false);
  expect(restored?.relativePosition).toEqual(savedWholeHousePreset?.position);
  expect(restored?.relativeTarget).toEqual(savedWholeHousePreset?.target);
  expect(restored?.viewHeight).toBe(savedWholeHousePreset?.viewHeight);
  expectCameraValuesAreFinite(restored);
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
