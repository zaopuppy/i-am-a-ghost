import { expect, test } from '@playwright/test';

test('the developer scene editor edits furniture, rooms, and walls with live validation', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });

  await page.goto('/?sceneEditor=1');
  await expect(page.getByTestId('scene-editor')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().furnitureCount ?? 0)).toBe(34);

  const baseline = await page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot());
  expect(baseline?.errors).toBe(0);
  expect(baseline?.movementColliderCount).toBe(22);

  const dragPoints = await page.evaluate(() => ({
    from: window.__HOUSE_SCENE_EDITOR__?.screenPoint(-10.5, -8),
    to: window.__HOUSE_SCENE_EDITOR__?.screenPoint(-9.8, -8),
  }));
  expect(dragPoints.from).toBeTruthy();
  expect(dragPoints.to).toBeTruthy();
  await page.mouse.move(dragPoints.from!.x, dragPoints.from!.y);
  await page.mouse.down();
  await page.mouse.move(dragPoints.to!.x, dragPoints.to!.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() =>
    window.__HOUSE_SCENE_EDITOR__?.snapshot().scene.furniture
      .find((item) => item.id === 'nursery-bed')?.offsetX ?? 0,
  )).toBeGreaterThan(0.5);
  await page.locator('[data-editor-undo]').click();

  await page.locator('[data-editor-room]').selectOption('foyer');
  await page.locator('[data-editor-asset]').selectOption('table_small');
  await page.locator('[data-editor-add-furniture]').click();
  await expect.poll(() => page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().furnitureCount ?? 0)).toBe(35);
  await expect.poll(() => page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().errors ?? 0)).toBeGreaterThan(0);

  await page.locator('[data-editor-undo]').click();
  await expect.poll(() => page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().errors ?? -1)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().furnitureCount ?? 0)).toBe(34);

  const rotatedYaw = await page.evaluate(() => {
    const editor = window.__HOUSE_SCENE_EDITOR__;
    editor?.select('furniture', 'nursery-bed');
    editor?.rotateSelected(15);
    return editor?.snapshot().scene.furniture.find((item) => item.id === 'nursery-bed')?.yawRadians;
  });
  expect(rotatedYaw).toBeCloseTo(Math.PI / 12, 5);

  const roomCenter = await page.evaluate(() => {
    const editor = window.__HOUSE_SCENE_EDITOR__;
    editor?.select('room', 'nursery');
    editor?.moveSelected(-10.25, -6.5);
    return editor?.snapshot().scene.rooms.find((room) => room.id === 'nursery')?.center;
  });
  expect(roomCenter).toEqual({ x: -10.25, z: -6.5 });

  await page.locator('[data-editor-add-wall]').click();
  await expect.poll(() => page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().scene.walls.length ?? 0)).toBe(19);

  const exported = await page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.exportJson() ?? '');
  expect(JSON.parse(exported).version).toBe(1);
  expect(pageErrors).toEqual([]);
});
