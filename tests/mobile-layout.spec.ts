import { expect, test } from '@playwright/test';

for (const viewport of [
  { name: 'compact landscape', width: 707, height: 440 },
  { name: 'narrow portrait', width: 390, height: 844 },
]) {
  test(`${viewport.name} role selection remains reachable without horizontal overflow`, async ({ context }) => {
    const host = await context.newPage();
    const guest = await context.newPage();
    await host.setViewportSize({ width: viewport.width, height: viewport.height });
    await Promise.all([host.goto('/'), guest.goto('/')]);
    await Promise.all([host, guest].map((page) => page.evaluate(() => {
      window.__THREE_GAME_TEST_HOOKS__?.hideDebugUi(true);
    })));
    await host.getByTestId('create-room').click();
    await expect(host.getByTestId('room-code')).toHaveText(/^[A-Z0-9]{6}$/);
    const roomCode = (await host.getByTestId('room-code').textContent())?.trim() ?? '';
    await guest.getByTestId('room-code-input').fill(roomCode);
    await guest.getByTestId('join-room').click();
    await expect(host.getByTestId('roster').locator('li')).toHaveCount(2);

    const ghostChoice = host.getByTestId('lobby-role-picker').locator('[data-role-choice="ghost"]');
    const childChoice = host.getByTestId('lobby-role-picker').locator('[data-role-choice="child"]');
    for (const choice of [ghostChoice, childChoice]) {
      await choice.scrollIntoViewIfNeeded();
      await expect(choice).toBeInViewport();
      const bounds = await choice.boundingBox();
      expect(bounds?.width ?? 0).toBeGreaterThanOrEqual(120);
      expect(bounds?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await ghostChoice.click();
    await guest.getByTestId('lobby-role-picker').locator('[data-role-choice="child"]').click();
    await host.getByTestId('start-match').scrollIntoViewIfNeeded();
    await expect(host.getByTestId('start-match')).toBeEnabled();
    await expect(host.getByTestId('start-match')).toBeInViewport();

    const layout = await host.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
      panelWidth: document.querySelector<HTMLElement>('.lobby-panel')?.scrollWidth ?? 0,
      panelClientWidth: document.querySelector<HTMLElement>('.lobby-panel')?.clientWidth ?? 0,
    }));
    expect(layout.contentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.panelWidth).toBeLessThanOrEqual(layout.panelClientWidth);
    await test.info().attach(`${viewport.name}-role-selection.png`, {
      body: await host.screenshot(),
      contentType: 'image/png',
    });
  });
}
