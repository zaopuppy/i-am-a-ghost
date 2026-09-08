import { expect, test } from '@playwright/test';

test('solo walking never switches to idle between simulation ticks', async ({ page }) => {
  await page.goto('/?testState=child-playing');
  const interruptions = await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const { GameWorld } = await load('/src/game/GameWorld.ts');
    const { SoloMatch } = await load('/src/game/SoloMatch.ts');
    const { DEFAULT_HOUSE_MAP } = await load('/src/game/defaultHouse.ts');
    const world = new GameWorld();
    const match = new SoloMatch({
      ...DEFAULT_HOUSE_MAP, walls: [], furniture: [],
      ghostSpawn: { x: -10, z: -10 },
      childSpawns: [{ x: 0, z: 0 }, { x: 0, z: 4 }, { x: 0, z: -4 }, { x: 4, z: 4 }],
    }, { role: 'child', childCount: 1, seed: 71 });
    try {
      await world.prewarmCharacterAssets(async () => {});
      world.sync(match.presentationFrame(), 1);
      const actor = world.actors.get('child:solo-child-0');
      if (!actor?.imported) throw new Error('Imported walking actor missing');
      const interrupted: number[] = [];
      let elapsed = 1;
      for (let index = 0; index < 80; index += 1) {
        const delta = index < 40 ? 0.016 : 1 / 144;
        elapsed += delta;
        match.update(delta, { x: 1, z: 0 }, 0, false);
        world.sync(match.presentationFrame(), elapsed);
        if (index > 2 && actor.currentAnimation !== 'Running_A') interrupted.push(index);
      }
      return interrupted;
    } finally {
      world.dispose();
    }
  });
  expect(interruptions).toEqual([]);
});
