import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }]) {
  test(`other child capture focuses the scene at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?testState=child-playing');
    await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
    await page.evaluate(() => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      hooks.hideDebugUi(true);
      hooks.setPausedForScreenshot(true);
      hooks.setState('capture-other');
    });
    await page.waitForFunction(() => {
      const data = window.__THREE_GAME_DIAGNOSTICS__;
      return data?.cameraMode === 'capture-closeup'
        && data.world.pendingAssetUpgrades === 0;
    });
    const data = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!);
    const frame = data.viewerFrame!;
    expect(frame.viewerPlayerId).toBe('child-2');
    expect(frame.capture?.childPlayerId).toBe('child-1');
    expect(frame.ghost).toBeDefined();
    const caught = frame.children.find((child) => child.playerId === frame.capture?.childPlayerId)!;
    expect(data.camera.target.x).toBeCloseTo((caught.position.x + frame.ghost!.position.x) / 2, 2);
    expect(data.camera.target.z).toBeCloseTo((caught.position.z + frame.ghost!.position.z) / 2, 2);
    expect(data.cameraViewHeight).toBeCloseTo(5.2, 2);
    await expect(page.getByTestId('event-banner')).toContainText('鬼抓住了一个孩子');
    await page.screenshot({ path: testInfo.outputPath('observer-capture.png') });
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('protection'));
    await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.cameraMode === 'follow');
    const reset = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!);
    expect(reset.viewerFrame?.ghost).toBeUndefined();
    expect(reset.cameraViewHeight).toBeCloseTo(13.2, 2);
    await expect(page.locator('html')).toHaveAttribute('data-capture-scare', 'false');
    expect(errors).toEqual([]);
  });
}
