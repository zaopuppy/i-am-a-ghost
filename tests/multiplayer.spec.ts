import { expect, test, type Page } from '@playwright/test';

test('two browser pages join, start, and move through the authoritative input path', async ({ context }) => {
  const host = await context.newPage();
  const guest = await context.newPage();
  const errors: string[] = [];
  collectErrors(host, errors);
  collectErrors(guest, errors);

  await Promise.all([host.goto('/'), guest.goto('/')]);
  await host.getByTestId('create-room').click();
  await expect(host.getByTestId('room-code')).not.toHaveText('——');
  const roomCode = (await host.getByTestId('room-code').textContent())?.trim() ?? '';
  expect(roomCode).toMatch(/^[A-Z2-9]{6}$/);

  await guest.getByTestId('room-code-input').fill(roomCode);
  await guest.getByTestId('join-room').click();
  await expect(host.getByTestId('roster').locator('li')).toHaveCount(2);
  await expect(guest.getByTestId('roster').locator('li')).toHaveCount(2);
  await host.getByTestId('start-match').click();

  await expect
    .poll(async () => Promise.all([readRole(host), readRole(guest)]))
    .toEqual(expect.arrayContaining(['ghost', 'child']));
  const hostRole = await readRole(host);
  const childPage = hostRole === 'child' ? host : guest;
  const childFrame = await childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.viewerFrame);
  expect(childFrame?.viewerRole).toBe('child');
  if (childFrame?.viewerRole === 'child') expect(childFrame.ghost).toBeUndefined();

  const initialX = await childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.ownPosition?.x ?? null);
  expect(initialX).not.toBeNull();
  await childPage.keyboard.down('f');
  await expect
    .poll(async () => childPage.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.ownPosition?.x ?? null))
    .toBeGreaterThan((initialX ?? 0) + 0.1);
  await childPage.keyboard.up('f');

  expect(errors).toEqual([]);
});

function readRole(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.role ?? null);
}

function collectErrors(page: Page, errors: string[]): void {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
}
