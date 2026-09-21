import { expect, test } from '@playwright/test';

test('solo house and child model choices reach the rendered match', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('#solo-game').click();
  await page.locator('#solo-houses [data-house-choice="ring-old-house"]').click();
  await page.locator('[data-solo-role="child"]').click();
  await page.locator('#solo-models [data-model-choice="scout"]').click();
  await expect(page.locator('#solo-houses [data-house-choice="ring-old-house"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#solo-models [data-model-choice="scout"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#solo-start')).toBeEnabled({ timeout: 45_000 });
  await page.locator('#solo-start').click();
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.role), { timeout: 60_000 }).toBe('child');
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.sceneId)).toBe('ring-old-house');
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world.assets.scout.status)).toBe('ready');
  expect(errors).toEqual([]);
});

test('room house and per-player models reach both clients', async ({ context }) => {
  test.setTimeout(120_000);
  const host = await context.newPage();
  const guest = await context.newPage();
  const errors: string[] = [];
  for (const page of [host, guest]) page.on('pageerror', (error) => errors.push(error.message));
  await Promise.all([host.goto('/'), guest.goto('/')]);
  await host.locator('#create-room').click();
  const code = (await host.locator('#room-code').textContent())!.trim();
  await guest.locator('#room-code-input').fill(code);
  await guest.locator('#join-room').click();
  await expect(guest.locator('#roster li')).toHaveCount(2);
  await host.locator('#lobby-houses [data-house-choice="ring-old-house"]').click();
  await expect(guest.locator('#lobby-houses [data-house-choice="ring-old-house"]')).toHaveAttribute('aria-pressed', 'true');
  await host.locator('#lobby-role-picker [data-role-choice="ghost"]').click();
  await guest.locator('#lobby-role-picker [data-role-choice="child"]').click();
  await host.locator('#lobby-models [data-model-choice="wraith"]').click();
  await guest.locator('#lobby-models [data-model-choice="scout"]').click();
  await expect(host.locator('#lobby-models [data-model-choice="wraith"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(guest.locator('#lobby-models [data-model-choice="scout"]')).toHaveAttribute('aria-pressed', 'true');
  await host.locator('#start-match').click();
  await expect.poll(() => host.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.role), { timeout: 75_000 }).toBe('ghost');
  await expect.poll(() => guest.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.role), { timeout: 75_000 }).toBe('child');
  for (const page of [host, guest]) {
    const world = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world);
    expect(world?.sceneId).toBe('ring-old-house');
    expect(world?.assets.wraith.status).toBe('ready');
    expect(world?.assets.scout.status).toBe('ready');
  }
  expect(errors).toEqual([]);
});

test('Scout rig attaches and aims the flashlight through its own joint map', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?testState=child-playing');
  const result = await page.evaluate(async () => {
    const { GameWorld } = await import('/src/game/GameWorld.ts');
    const { createDeterministicViewerFrame } = await import('/src/testing/DeterministicStates.ts');
    const world = new GameWorld();
    world.setCharacterModels(['scout'], 'wraith');
    const frame = createDeterministicViewerFrame('child-playing', 71);
    const child = frame.children.find((candidate) => candidate.playerId === 'child-1')!;
    child.flashlightOn = true;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      world.sync(frame, attempt / 60);
      if (world['actors'].get('child:child-1')?.imported) break;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    const actor = world['actors'].get('child:child-1')!;
    for (let tick = 1; tick <= 90; tick += 1) world.sync(frame, 2 + tick / 60);
    const joints = actor.imported?.joints;
    const attached = actor.flashlight?.root.parent === joints?.rightHandSlot;
    const muzzle = actor.flashlight?.muzzle;
    const rotation = muzzle?.getWorldQuaternion(muzzle.quaternion.clone());
    const directionX = rotation ? 1 - 2 * (rotation.y ** 2 + rotation.z ** 2) : 0;
    const output = {
      modelId: actor.imported?.modelId,
      attached,
      jointsReady: Boolean(joints?.chest && joints.head && joints.rightUpperArm && joints.rightLowerArm
        && joints.leftUpperLeg && joints.rightUpperLeg && joints.leftLowerLeg && joints.rightLowerLeg),
      directionX,
      handY: joints?.rightHandSlot?.getWorldPosition(actor.root.position.clone()).y,
    };
    world.dispose();
    const ghostWorld = new GameWorld();
    ghostWorld.setCharacterModels([], 'wraith');
    const ghostFrame = createDeterministicViewerFrame('ghost-playing', 71);
    for (let attempt = 0; attempt < 180; attempt += 1) {
      ghostWorld.sync(ghostFrame, attempt / 60);
      if (ghostWorld['actors'].get('ghost')?.imported) break;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    const ghost = ghostWorld['actors'].get('ghost');
    const wraith = {
      modelId: ghost?.imported?.modelId,
      jointsReady: Boolean(ghost?.imported?.joints.chest && ghost.imported.joints.head
        && ghost.imported.joints.rightUpperArm && ghost.imported.joints.leftUpperArm),
      fallbackHidden: ghost?.ghostRig?.fallbackVisual.visible === false,
    };
    ghostWorld.dispose();
    return { scout: output, wraith };
  });
  expect(result.scout.modelId).toBe('scout');
  expect(result.scout.attached).toBe(true);
  expect(result.scout.jointsReady).toBe(true);
  expect(result.scout.directionX).toBeGreaterThan(0.95);
  expect(result.scout.handY).toBeGreaterThan(0.8);
  expect(result.scout.handY).toBeLessThan(1.2);
  expect(result.wraith).toEqual({ modelId: 'wraith', jointsReady: true, fallbackHidden: true });
});

test('opening scene uses selected character assets', async ({ page }) => {
  await page.goto('/');
  const models = await page.evaluate(async () => {
    const { OpeningScene } = await import('/src/game/OpeningScene.ts');
    const scene = new OpeningScene(['scout'], 'wraith');
    await scene.ready;
    scene.update(5.6, 16 / 9);
    const selected = {
      child: scene['children'][0]?.modelId,
      ghost: scene['ghost']?.modelId,
      hand: scene['children'][0]?.joints.rightHand?.name,
    };
    scene.dispose();
    return selected;
  });
  expect(models).toEqual({ child: 'scout', ghost: 'wraith', hand: 'Scout_PalmR' });
});
