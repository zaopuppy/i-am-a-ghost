import { expect, test } from '@playwright/test';

test('first interaction loads one IDM-safe audio pack without media requests', async ({ page }) => {
  const audioRequests: Array<{ type: string; url: string }> = [];
  page.on('request', (request) => {
    if (request.url().includes('/assets/audio/')) {
      audioRequests.push({ type: request.resourceType(), url: request.url() });
    }
  });

  await page.goto('/');
  expect(audioRequests).toEqual([]);
  await page.getByTestId('create-room').click();
  await expect.poll(async () => page.evaluate(() => {
    const audio = window.__THREE_GAME_DIAGNOSTICS__?.audio;
    return (audio?.loaded ?? 0) + (audio?.failed ?? 0);
  }), { timeout: 15_000 }).toBe(5);

  expect(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio.failed)).toBe(0);
  expect(audioRequests.filter((request) => request.type === 'media')).toEqual([]);
  expect(audioRequests.filter((request) => request.url.endsWith('.mp3'))).toEqual([]);
  expect(audioRequests).toEqual([
    {
      type: 'fetch',
      url: 'http://127.0.0.1:5189/assets/audio/kenney/sfx-pack.json',
    },
  ]);
});
