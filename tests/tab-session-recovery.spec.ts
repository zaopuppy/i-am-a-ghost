import { expect, test } from '@playwright/test';

test('a promoted host can start after the previous host disconnects', async ({ context }) => {
  const host = await context.newPage();
  const guest = await context.newPage();

  await Promise.all([host.goto('/'), guest.goto('/')]);
  await host.getByTestId('create-room').click();
  await expect(host.getByTestId('room-code')).not.toHaveText('——');
  const roomCode = (await host.getByTestId('room-code').textContent())?.trim() ?? '';
  await guest.getByTestId('room-code-input').fill(roomCode);
  await guest.getByTestId('join-room').click();
  await expect(host.getByTestId('roster').locator('li')).toHaveCount(2);
  await expect(guest.getByTestId('roster').locator('li')).toHaveCount(2);

  await host.close();
  await expect(guest.getByTestId('roster').locator('li')).toHaveCount(1);

  const replacement = await context.newPage();
  await replacement.goto('/');
  await replacement.getByTestId('room-code-input').fill(roomCode);
  await replacement.getByTestId('join-room').click();
  await expect(guest.getByTestId('roster').locator('li')).toHaveCount(2);
  await expect(replacement.getByTestId('roster').locator('li')).toHaveCount(2);
  await expect(guest.getByTestId('start-match')).toBeVisible();
  await expect(guest.getByTestId('start-match')).toBeEnabled();
  await expect(replacement.getByTestId('start-match')).toBeHidden();
});
