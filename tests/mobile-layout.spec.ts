import { expect, test } from '@playwright/test';

test('compact landscape viewport does not overflow the screen', async ({ page }) => {
  await page.setViewportSize({ width: 707, height: 440 });
  await page.goto('/');

  const layout = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    viewportHeight: document.documentElement.clientHeight,
    contentWidth: document.documentElement.scrollWidth,
    contentHeight: document.documentElement.scrollHeight,
  }));

  expect(layout.contentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.contentHeight).toBeLessThanOrEqual(layout.viewportHeight);
});
