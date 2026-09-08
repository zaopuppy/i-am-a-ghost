import { expect, test } from '@playwright/test';

test('restarting as a child clears the previous burning ghost instead of displaying it at its old position', async ({ page }) => {
  await page.goto('/?testState=child-playing');
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const { GameWorld } = await load('/src/game/GameWorld.ts');
    const { SoloMatch } = await load('/src/game/SoloMatch.ts');
    const { DEFAULT_HOUSE_MAP } = await load('/src/game/defaultHouse.ts');
    const world = new GameWorld();
    try {
      await world.prewarmCharacterAssets(async () => {});
      const oldMatch = new SoloMatch(DEFAULT_HOUSE_MAP, { role: 'ghost', childCount: 1, seed: 71 });
      const oldFrame = oldMatch.frame();
      oldFrame.ghost.position = { x: 2, z: 3 };
      oldFrame.ghost.burning = true;
      oldFrame.ghost.burnTicksRemaining = 90;
      world.sync(oldFrame, 50);
      const ghost = world.actors.get('ghost');
      if (!ghost?.root.visible) throw new Error('Previous ghost fixture missing');
      world.sync(null, 0);
      const fresh = new SoloMatch(DEFAULT_HOUSE_MAP, { role: 'child', childCount: 1, seed: 71 });
      const frame = fresh.presentationFrame();
      world.sync(frame, 0);
      const visibleAtStart = ghost.root.visible;
      world.sync(frame, 10);
      const visibleLater = ghost.root.visible;
      const revealed = oldMatch.frame();
      world.sync(revealed, 11);
      const resetPosition = { x: ghost.root.position.x, z: ghost.root.position.z };
      const stillBurning = ghost.ghostRig.fireGroup.visible;
      world.sync(frame, 11.125);
      const fadingNormally = ghost.root.visible;
      world.sync(frame, 11.3);
      return {
        authorityHasGhost: Boolean(frame.ghost), visibleAtStart, visibleLater,
        resetPosition, spawn: DEFAULT_HOUSE_MAP.ghostSpawn, stillBurning,
        fadingNormally, visibleAfterFade: ghost.root.visible,
      };
    } finally { world.dispose(); }
  });
  expect(result.authorityHasGhost).toBe(false);
  expect(result.visibleAtStart).toBe(false);
  expect(result.visibleLater).toBe(false);
  expect(result.resetPosition).toEqual(result.spawn);
  expect(result.stillBurning).toBe(false);
  expect(result.fadingNormally).toBe(true);
  expect(result.visibleAfterFade).toBe(false);
});
