import { expect, test } from '@playwright/test';

const EXPECTED_AUDIO_ASSET_COUNT = 9;

test('waits for a complete click before unlocking mobile audio', async ({ page }) => {
  await page.goto('/');
  await page.mouse.move(1_200, 600);
  await page.mouse.down();
  await page.waitForTimeout(350);

  expect(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio)).toMatchObject({
    unlocked: false,
    loaded: 0,
    failed: 0,
  });

  await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => (
    window.__THREE_GAME_DIAGNOSTICS__?.audio.loaded ?? 0
  )), { timeout: 15_000 }).toBe(EXPECTED_AUDIO_ASSET_COUNT);
  expect(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio.unlocked)).toBe(true);
});

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
  }), { timeout: 15_000 }).toBe(EXPECTED_AUDIO_ASSET_COUNT);

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
  )), { timeout: 15_000 }).toBe(EXPECTED_AUDIO_ASSET_COUNT);

  const metrics = await page.evaluate(async () => {
    const modulePath = '/src/audio/GameAudio.ts';
    const { GameAudio } = await import(/* @vite-ignore */ modulePath);
    const thunder = new GameAudio();
    await thunder.unlock();
    thunder.playThunder(2, 17, 0.8, -0.4);
    return thunder.metrics();
  });

  expect(metrics.loaded).toBe(EXPECTED_AUDIO_ASSET_COUNT);
  expect(metrics.failed).toBe(0);
  expect(metrics.thunderPlays).toBe(1);
  expect(metrics.lastThunder?.variant).toBe(2);
  expect(metrics.lastThunder?.delaySeconds).toBe(0.8);
  expect(metrics.lastThunder?.pan).toBeCloseTo(-0.4, 6);
});

test('every thunder variant has an immediate mobile-readable attack', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await expect.poll(async () => page.evaluate(() => (
    window.__THREE_GAME_DIAGNOSTICS__?.audio.loaded ?? 0
  )), { timeout: 15_000 }).toBe(EXPECTED_AUDIO_ASSET_COUNT);

  const attacks = await page.evaluate(async () => {
    const modulePath = '/src/audio/GameAudio.ts';
    const { GameAudio } = await import(/* @vite-ignore */ modulePath);
    const thunder = new GameAudio();
    await thunder.unlock();
    const buffers = (thunder as unknown as {
      buffers: Map<string, AudioBuffer>;
    }).buffers;
    const results = [];
    for (const id of ['thunder1', 'thunder2', 'thunder3']) {
      const buffer = buffers.get(id);
      if (!buffer) continue;
      const sampleRate = 44_100;
      const frameCount = Math.round(sampleRate * 0.35);
      const offline = new OfflineAudioContext(1, frameCount, sampleRate);
      const source = offline.createBufferSource();
      const highpass = offline.createBiquadFilter();
      const runtimeLowpass = offline.createBiquadFilter();
      const worstDistanceGain = offline.createGain();
      source.buffer = buffer;
      highpass.type = 'highpass';
      highpass.frequency.value = 250;
      runtimeLowpass.type = 'lowpass';
      runtimeLowpass.frequency.value = 2_800;
      worstDistanceGain.gain.value = 0.72 * 0.55;
      source
        .connect(highpass)
        .connect(runtimeLowpass)
        .connect(worstDistanceGain)
        .connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      const samples = rendered.getChannelData(0);
      let sumSquares = 0;
      let peak = 0;
      for (const sample of samples) {
        sumSquares += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      results.push({
        id,
        rmsDb: 20 * Math.log10(Math.sqrt(sumSquares / samples.length)),
        peakDb: 20 * Math.log10(peak),
      });
    }
    thunder.dispose();
    return results;
  });

  expect(attacks).toHaveLength(3);
  for (const attack of attacks) {
    expect.soft(attack.rmsDb, `${attack.id} attack RMS`).toBeGreaterThan(-30);
    expect.soft(attack.peakDb, `${attack.id} attack peak`).toBeGreaterThan(-14);
  }
});

test('decoded burn scream reaches the one-shot playback graph', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await expect.poll(async () => page.evaluate(() => (
    window.__THREE_GAME_DIAGNOSTICS__?.audio.loaded ?? 0
  )), { timeout: 15_000 }).toBe(EXPECTED_AUDIO_ASSET_COUNT);

  const playback = await page.evaluate(async () => {
    const modulePath = '/src/audio/GameAudio.ts';
    const { GameAudio } = await import(/* @vite-ignore */ modulePath);
    const burn = new GameAudio();
    await burn.unlock();
    const buffer = (burn as unknown as {
      buffers: Map<string, AudioBuffer>;
    }).buffers.get('burnScream');
    burn.playBurnScream(1);
    burn.playBurnScream(1);
    const result = {
      duration: buffer?.duration ?? 0,
      metrics: burn.metrics(),
    };
    burn.dispose();
    return result;
  });

  expect(playback.duration).toBeGreaterThan(1.45);
  expect(playback.duration).toBeLessThan(1.6);
  expect(playback.metrics.burnScreamPlays).toBe(1);
  expect(playback.metrics.failed).toBe(0);
});
