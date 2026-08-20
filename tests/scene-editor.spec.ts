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

  const openPanel = await page.getByTestId('scene-editor').boundingBox();
  const openCanvas = await page.locator('#game-canvas').boundingBox();
  expect(openPanel).toBeTruthy();
  expect(openCanvas).toBeTruthy();
  expect(openPanel!.x + openPanel!.width).toBeLessThanOrEqual(openCanvas!.x);
  await page.locator('[data-editor-collapse]').click();
  await expect.poll(() => page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().panelCollapsed)).toBe(true);
  const collapsedCanvas = await page.locator('#game-canvas').boundingBox();
  expect(collapsedCanvas!.x).toBeLessThan(openCanvas!.x);
  await page.locator('[data-editor-collapse]').click();
  await expect.poll(() => page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().panelCollapsed)).toBe(false);

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

  const canvas = await page.locator('#game-canvas').boundingBox();
  expect(canvas).toBeTruthy();
  const cameraBeforeRotate = await page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().viewport);
  await page.mouse.move(canvas!.x + canvas!.width * 0.62, canvas!.y + canvas!.height * 0.48);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(canvas!.x + canvas!.width * 0.72, canvas!.y + canvas!.height * 0.55, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await expect.poll(async () => {
    const current = await page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().viewport.position);
    return Math.hypot(
      (current?.x ?? 0) - (cameraBeforeRotate?.position.x ?? 0),
      (current?.z ?? 0) - (cameraBeforeRotate?.position.z ?? 0),
    );
  }).toBeGreaterThan(0.2);

  const targetBeforePan = await page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().viewport.target);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(canvas!.x + canvas!.width * 0.66, canvas!.y + canvas!.height * 0.48, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
  await expect.poll(async () => {
    const current = await page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().viewport.target);
    return Math.hypot(
      (current?.x ?? 0) - (targetBeforePan?.x ?? 0),
      (current?.z ?? 0) - (targetBeforePan?.z ?? 0),
    );
  }).toBeGreaterThan(0.2);

  const zoomBefore = await page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().viewport.zoom ?? 0);
  await page.mouse.wheel(0, -500);
  await expect.poll(() => page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().viewport.zoom ?? 0))
    .toBeGreaterThan(zoomBefore);

  await page.locator('[data-editor-camera-mode="navigate"]').click();
  await expect.poll(() => page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().viewport.mode)).toBe('navigate');
  const targetBeforeNavigate = await page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().viewport.target);
  await page.mouse.down();
  await page.mouse.move(canvas!.x + canvas!.width * 0.58, canvas!.y + canvas!.height * 0.42, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const current = await page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().viewport.target);
    return Math.hypot(
      (current?.x ?? 0) - (targetBeforeNavigate?.x ?? 0),
      (current?.z ?? 0) - (targetBeforeNavigate?.z ?? 0),
    );
  }).toBeGreaterThan(0.2);
  await page.locator('[data-editor-camera-mode="edit"]').click();
  await page.locator('[data-editor-frame-house]').click();
  await expect.poll(() => page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().viewport.target.x ?? 1)).toBe(0);

  await page.locator('[data-editor-room]').selectOption('foyer');
  await page.locator('[data-editor-asset]').selectOption('table_small');
  await page.locator('[data-editor-add-furniture]').click();
  await expect.poll(() => page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().furnitureCount ?? 0)).toBe(35);
  await expect.poll(() => page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().errors ?? 0)).toBeGreaterThan(0);

  const addedFurnitureId = await page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().selection?.id ?? '');
  expect(addedFurnitureId).not.toBe('');
  await page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.moveSelected(20, 0));
  await page.locator('[data-editor-issue-filter]').selectOption('outside-room');
  const outsideIssue = page.locator(`[data-editor-issues] li[data-code="outside-room"][data-subject-id="${addedFurnitureId}"]`);
  await expect(outsideIssue).toBeVisible();
  await page.locator('[data-editor-clear-issues]').click();
  await expect(outsideIssue).toHaveCount(0);
  await expect(page.locator('[data-editor-issues] .scene-editor__empty-issues')).toContainText('已清除');
  await page.locator('[data-editor-restore-issues]').click();
  await expect(outsideIssue).toBeVisible();
  await outsideIssue.locator('button').click();
  await expect.poll(() => page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().viewport.target.x ?? 0)).toBe(20);
  await page.locator('[data-editor-issue-filter]').selectOption('all');

  await page.locator('[data-editor-undo]').click();
  await page.locator('[data-editor-undo]').click();
  await expect.poll(() => page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().errors ?? -1)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().furnitureCount ?? 0)).toBe(34);

  const rotation = await page.evaluate(() => {
    const editor = window.__HOUSE_SCENE_EDITOR__;
    editor?.select('furniture', 'nursery-bed');
    const before = editor?.snapshot().scene.furniture
      .find((item) => item.id === 'nursery-bed')?.yawRadians ?? 0;
    editor?.rotateSelected(15);
    const after = editor?.snapshot().scene.furniture
      .find((item) => item.id === 'nursery-bed')?.yawRadians ?? 0;
    return { before, after };
  });
  expect(rotation.after - rotation.before).toBeCloseTo(Math.PI / 12, 5);

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

test('legacy editor drafts gain structural room bounds without moving furniture', async ({ page }) => {
  await page.goto('/?sceneEditor=1');
  await expect.poll(() => page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().furnitureCount ?? 0)).toBe(34);
  const migrationExpectation = await page.evaluate(() => {
    const scene = window.__HOUSE_SCENE_EDITOR__!.snapshot().scene;
    const defaultNursery = scene.rooms.find((room) => room.id === 'nursery')!;
    const expectedRoom = {
      center: { ...defaultNursery.center },
      width: defaultNursery.width,
      depth: defaultNursery.depth,
    };
    for (const room of scene.rooms) {
      room.center.x = room.center.x < 0 ? -10.5 : room.center.x > 0 ? 10.5 : 0;
      room.width = 9.3;
      room.depth = 5.8;
    }
    const bed = scene.furniture.find((item) => item.id === 'nursery-bed')!;
    const nursery = scene.rooms.find((room) => room.id === bed.roomId)!;
    localStorage.setItem('i-am-a-ghost:house-scene-draft:v1', JSON.stringify(scene));
    return {
      expectedRoom,
      legacyBedPosition: { x: nursery.center.x + bed.offsetX, z: nursery.center.z + bed.offsetZ },
    };
  });

  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__HOUSE_SCENE_EDITOR__?.snapshot().furnitureCount ?? 0)).toBe(34);
  const migrated = await page.evaluate(() => {
    const scene = window.__HOUSE_SCENE_EDITOR__!.snapshot().scene;
    const nursery = scene.rooms.find((room) => room.id === 'nursery')!;
    const bed = scene.furniture.find((item) => item.id === 'nursery-bed')!;
    return {
      room: nursery,
      bedPosition: { x: nursery.center.x + bed.offsetX, z: nursery.center.z + bed.offsetZ },
    };
  });
  expect(migrated.room.center).toEqual(migrationExpectation.expectedRoom.center);
  expect(migrated.room.width).toBe(migrationExpectation.expectedRoom.width);
  expect(migrated.room.depth).toBe(migrationExpectation.expectedRoom.depth);
  expect(migrated.bedPosition.x).toBeCloseTo(migrationExpectation.legacyBedPosition.x, 6);
  expect(migrated.bedPosition.z).toBeCloseTo(migrationExpectation.legacyBedPosition.z, 6);
});
