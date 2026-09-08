import { expect, test, type Page } from '@playwright/test';

async function readInput(page: Page) {
  return page.evaluate(() => (window as Window & {
    __sampleControls: () => {
      move: { x: number; z: number };
      aim: { x: number; z: number };
      action: boolean;
    };
  }).__sampleControls());
}

test('desktop flashlight uses held left click only and releases outside the canvas or on blur', async ({ page }) => {
  await page.goto('/?testState=child-playing');
  await expect(page.getByTestId('role-label')).toContainText('小孩', { timeout: 20_000 });
  await page.evaluate(async () => {
    const path = '/src/core/GameInput.ts';
    const { GameInput } = await import(path);
    const input = new GameInput();
    Object.assign(window, {
      __sampleControls: () => ({
        move: input.movement(), aim: input.aimDirection(), action: input.actionHeld(),
      }),
    });
  });
  await expect(page.locator('#control-hint')).toContainText('按住鼠标左键照明');
  await page.keyboard.down('Space');
  expect((await readInput(page)).action).toBe(false);
  await page.keyboard.up('Space');
  await page.mouse.move(800, 400);
  await page.mouse.down({ button: 'right' });
  expect((await readInput(page)).action).toBe(false);
  await page.mouse.up({ button: 'right' });
  await page.keyboard.press('Escape');
  await page.mouse.down({ button: 'left' });
  expect((await readInput(page)).action).toBe(true);
  await page.mouse.move(750, 350);
  expect((await readInput(page)).action).toBe(true);
  const button = page.locator('#audio-toggle');
  const bounds = await button.boundingBox();
  if (!bounds) throw new Error('Audio control is missing.');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.up({ button: 'left' });
  expect((await readInput(page)).action).toBe(false);
  await page.mouse.down({ button: 'left' });
  expect((await readInput(page)).action).toBe(false);
  await page.mouse.up({ button: 'left' });
  await page.mouse.move(800, 400);
  await page.mouse.down({ button: 'left' });
  expect((await readInput(page)).action).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect((await readInput(page)).action).toBe(false);
  await page.mouse.up({ button: 'left' });
});

test('both floating sticks capture separate fingers and release independently', async ({ page, context }) => {
  await page.goto('/?testState=child-playing');
  await expect(page.getByTestId('role-label')).toContainText('小孩', { timeout: 20_000 });
  await page.evaluate(async () => {
    const path = '/src/core/GameInput.ts';
    const { GameInput } = await import(path);
    const input = new GameInput();
    Object.assign(window, {
      __sampleControls: () => ({
        move: input.movement(), aim: input.aimDirection(), action: input.actionHeld(),
      }),
    });
    document.querySelector<HTMLElement>('#touch-controls')!.hidden = false;
    document.documentElement.dataset.harmonyPlaying = 'true';
  });
  const session = await context.newCDPSession(page);
  const left = { id: 1, x: 220, y: 500 };
  const right = { id: 2, x: 990, y: 500 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [left] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [left, right] });
  await expect(page.locator('#touch-action')).toHaveAttribute('data-active', 'true');
  expect((await readInput(page)).action).toBe(true);
  expect((await readInput(page)).aim).toEqual({ x: 0, z: 0 });
  left.x += 35;
  right.x -= 35;
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [left, right] });
  const both = await readInput(page);
  expect(both.move.x).toBeGreaterThan(0.9);
  expect(both.aim.x).toBeLessThan(-0.9);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [right] });
  const releasedRight = await readInput(page);
  expect(releasedRight.action).toBe(false);
  expect(releasedRight.aim).toEqual({ x: 0, z: 0 });
  expect(releasedRight.move.x).toBeGreaterThan(0.9);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [left, right] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [left] });
  const releasedLeft = await readInput(page);
  expect(releasedLeft.move).toEqual({ x: 0, z: 0 });
  expect(releasedLeft.action).toBe(true);
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  expect(await readInput(page)).toEqual({ move: { x: 0, z: 0 }, aim: { x: 0, z: 0 }, action: false });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [left, right] });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await readInput(page)).toEqual({ move: { x: 0, z: 0 }, aim: { x: 0, z: 0 }, action: false });
  await expect(page.locator('#touch-action')).toHaveAttribute('data-active', 'false');
  await page.screenshot({ path: 'test-results/child-dual-stick.png' });
});
