import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

const VISUAL_STATES = ['child-playing', 'ghost-playing', 'capture', 'child-win'] as const;

for (const state of VISUAL_STATES) {
  test(`${state} deterministic visual baseline`, async ({ page }) => {
    const errors: string[] = [];
    collectErrors(page, errors);
    await openState(page, state);

    const png = PNG.sync.read(await page.locator('#game-canvas').screenshot());
    expect(lumaRange(png)).toBeGreaterThan(20);
    if (state === 'child-playing') {
      const ownHeadlamp = regionStats(png, 640, 360, 20);
      const nearbyWall = regionStats(png, 1032, 360, 5);
      expect(ownHeadlamp.brightPixels).toBeGreaterThan(30);
      expect(nearbyWall.meanLuma).toBeGreaterThan(18);
    }
    if (state === 'ghost-playing') {
      const litNpc = regionStats(png, 332, 573, 20);
      const unlitNpc = regionStats(png, 993, 560, 20);
      expect(litNpc.brightPixels).toBeGreaterThan(30);
      expect(unlitNpc.meanLuma).toBeGreaterThan(18);
      await expect(page.getByTestId('event-banner')).toContainText('锁定');
    }
    await expect(page).toHaveScreenshot(`${state}.png`, {
      animations: 'disabled',
      maxDiffPixelRatio: 0.008,
    });
    expect(errors).toEqual([]);
  });
}

test('hidden child state does not leak a ghost through browser diagnostics', async ({ page }) => {
  await openState(page, 'child-hidden');
  const frame = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.viewerFrame);
  expect(frame?.viewerRole).toBe('child');
  if (frame?.viewerRole === 'child') expect(frame.ghost).toBeUndefined();
  expect(JSON.stringify(frame)).not.toContain('"ghost"');
});

test('laptop PC viewport keeps the HUD bands separated and visible', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openState(page, 'low-battery');
  const layout = await page.evaluate(() => {
    const role = document.querySelector('.hud-role-block')?.getBoundingClientRect();
    const objective = document.querySelector('.hud-objective')?.getBoundingClientRect();
    const captures = document.querySelector('.hud-captures')?.getBoundingClientRect();
    const battery = document.querySelector('#battery-meter')?.getBoundingClientRect();
    return { role, objective, captures, battery };
  });
  expect(layout.role?.right ?? 0).toBeLessThan(layout.objective?.left ?? 0);
  expect(layout.objective?.right ?? 0).toBeLessThan(layout.captures?.left ?? 0);
  expect(layout.battery?.right ?? 2000).toBeLessThanOrEqual(1024);
  expect(layout.battery?.bottom ?? 2000).toBeLessThanOrEqual(768);
});

async function openState(page: Page, state: string): Promise<void> {
  await page.goto(`/?testState=${state}`);
  await page.waitForFunction(
    (expectedState) => {
      const diagnostics = window.__THREE_GAME_DIAGNOSTICS__;
      return diagnostics?.deterministicState === expectedState
        && diagnostics.frame > 10
        && diagnostics.world.assets.kid.status === 'ready'
        && diagnostics.world.assets.wall.status === 'ready';
    },
    state,
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    if (!hooks) throw new Error('Deterministic test hooks are missing.');
    hooks.seed(71);
    hooks.setPausedForScreenshot(true);
    hooks.setReducedMotion(true);
    hooks.hideDebugUi(true);
  });
  await page.waitForTimeout(100);
}

function collectErrors(page: Page, errors: string[]): void {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
}

function lumaRange(png: PNG): number {
  let minimum = 255;
  let maximum = 0;
  for (let index = 0; index < png.data.length; index += 4 * 97) {
    const luma = Math.round(
      png.data[index] * 0.2126 + png.data[index + 1] * 0.7152 + png.data[index + 2] * 0.0722,
    );
    minimum = Math.min(minimum, luma);
    maximum = Math.max(maximum, luma);
  }
  return maximum - minimum;
}

function regionStats(
  png: PNG,
  centerX: number,
  centerY: number,
  radius: number,
): { meanLuma: number; brightPixels: number } {
  let lumaSum = 0;
  let pixels = 0;
  let brightPixels = 0;
  for (let y = centerY - radius; y < centerY + radius; y += 1) {
    for (let x = centerX - radius; x < centerX + radius; x += 1) {
      const index = (y * png.width + x) * 4;
      const luma = Math.round(
        png.data[index] * 0.2126 + png.data[index + 1] * 0.7152 + png.data[index + 2] * 0.0722,
      );
      lumaSum += luma;
      pixels += 1;
      if (luma >= 120) brightPixels += 1;
    }
  }
  return { meanLuma: lumaSum / pixels, brightPixels };
}
