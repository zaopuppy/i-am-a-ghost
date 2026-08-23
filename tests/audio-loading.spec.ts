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
  }), { timeout: 15_000 }).toBe(8);

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

test('decoded thunder sample reaches the spatial playback graph', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await expect.poll(async () => page.evaluate(() => (
    window.__THREE_GAME_DIAGNOSTICS__?.audio.loaded ?? 0
  )), { timeout: 15_000 }).toBe(8);

  const metrics = await page.evaluate(async () => {
    const modulePath = '/src/audio/GameAudio.ts';
    const { GameAudio } = await import(/* @vite-ignore */ modulePath);
    const thunder = new GameAudio();
    await thunder.unlock();
    thunder.playThunder(2, 17, 0.8, -0.4);
    return thunder.metrics();
  });

  expect(metrics.loaded).toBe(8);
  expect(metrics.failed).toBe(0);
  expect(metrics.thunderPlays).toBe(1);
  expect(metrics.lastThunder?.variant).toBe(2);
  expect(metrics.lastThunder?.delaySeconds).toBe(0.8);
  expect(metrics.lastThunder?.pan).toBeCloseTo(-0.4, 6);
});
