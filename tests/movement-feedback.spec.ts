import { expect, test, type Page } from '@playwright/test';

async function indicator(page: Page) {
  return page.evaluate(() => (window as Window & {
    __readMovementIndicator: () => { visible: boolean; rotation: number };
  }).__readMovementIndicator());
}

for (const mobile of [false, true]) {
  test(`movement feedback follows input and clears on pause on ${mobile ? 'phone' : 'desktop'}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      viewport: mobile ? { width: 844, height: 390 } : { width: 1280, height: 720 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto('/');
      await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
      await page.evaluate(async () => {
        window.__THREE_GAME_TEST_HOOKS__!.hideDebugUi(true);
        const path = '/src/game/GameWorld.ts';
        const { GameWorld } = await import(path);
        const sync = GameWorld.prototype.sync;
        GameWorld.prototype.sync = function (...args: unknown[]) {
          const result = sync.apply(this, args);
          const mesh = this.scene.getObjectByName('local-movement-indicator');
          Object.assign(window, {
            __readMovementIndicator: () => ({ visible: mesh.visible, rotation: mesh.rotation.y }),
          });
          return result;
        };
      });
      await page.getByRole('button', { name: '单人游戏', exact: true }).click();
      await expect(page.locator('#solo-start')).toBeEnabled({ timeout: 30_000 });
      if (mobile) await page.locator('[data-solo-role="child"]').click();
      await page.locator('#solo-start').click();
      await expect(page.locator('#solo-dialog')).not.toBeVisible();
      await expect.poll(async () => (await indicator(page)).visible).toBe(false);
      if (mobile) {
        await expect(page.locator('#touch-controls')).toBeVisible();
        const session = await context.newCDPSession(page);
        const finger = { id: 1, x: 100, y: 290 };
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger] });
        finger.x += 150;
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [finger] });
        await expect.poll(async () => (await indicator(page)).visible).toBe(true);
        const before = (await indicator(page)).rotation;
        finger.x -= 48;
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [finger] });
        await expect.poll(async () => Math.cos((await indicator(page)).rotation - before)).toBeLessThan(-0.99);
        await page.screenshot({ path: testInfo.outputPath('movement-arrow-phone.png') });
        const stick = await page.locator('#touch-joystick').boundingBox();
        expect(stick!.x).toBeGreaterThanOrEqual(0);
        expect(stick!.x + stick!.width).toBeLessThanOrEqual(844);
        expect(stick!.y + stick!.height).toBeLessThanOrEqual(390);
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.keyboard.down('KeyD');
        await expect.poll(async () => (await indicator(page)).visible).toBe(true);
        const before = (await indicator(page)).rotation;
        await page.keyboard.up('KeyD');
        await page.keyboard.down('KeyA');
        await expect.poll(async () => Math.cos((await indicator(page)).rotation - before)).toBeLessThan(-0.99);
        await page.screenshot({ path: testInfo.outputPath('movement-arrow-desktop.png') });
        await page.keyboard.up('KeyA');
      }
      await expect.poll(async () => (await indicator(page)).visible).toBe(false);
      await page.keyboard.down('KeyD');
      await expect.poll(async () => (await indicator(page)).visible).toBe(true);
      await page.locator('#solo-pause').click();
      await expect.poll(async () => (await indicator(page)).visible).toBe(false);
      await page.keyboard.up('KeyD');
      await page.locator('#solo-resume').click();
      await expect.poll(async () => (await indicator(page)).visible).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
