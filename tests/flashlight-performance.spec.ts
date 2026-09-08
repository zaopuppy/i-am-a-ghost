import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

const MAX_TRANSITION_FRAME_MS = 50;
const MAX_NON_BEAM_MEAN_LUMA_DELTA = 2;

test('render prewarming covers first flashlight, ghost reveal, burn, and lightning', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  collectErrors(page, errors);
  await openProfileState(page, 'flashlight-profile-off');
  const baselinePrograms = await page.evaluate(
    () => window.__THREE_GAME_DIAGNOSTICS__?.renderer.programs ?? -1,
  );

  const firstFlashlight = await measureTransition(page, 'flashlight-profile-on');
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('flashlight-profile-off'));
  await settleFrames(page, 8);
  const firstGhostReveal = await measureTransition(page, 'flashlight-profile-hit');
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('flashlight-profile-off'));
  await settleFrames(page, 8);
  const firstLightning = await measureTransition(page, 'lightning-north-main');
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('flashlight-profile-off'));
  await settleFrames(page, 8);
  const simultaneousHit = await measureTransition(page, 'flashlight-lightning-hit');

  console.log(JSON.stringify({
    baselinePrograms,
    firstFlashlight,
    firstGhostReveal,
    firstLightning,
    simultaneousHit,
  }));
  expect(firstFlashlight.maximumMs).toBeLessThan(MAX_TRANSITION_FRAME_MS);
  expect(firstGhostReveal.maximumMs).toBeLessThan(MAX_TRANSITION_FRAME_MS);
  expect(firstLightning.maximumMs).toBeLessThan(MAX_TRANSITION_FRAME_MS);
  expect(simultaneousHit.maximumMs).toBeLessThan(MAX_TRANSITION_FRAME_MS);
  expect(firstFlashlight.programs).toBe(baselinePrograms);
  expect(firstGhostReveal.programs).toBe(baselinePrograms);
  expect(firstLightning.programs).toBe(baselinePrograms);
  expect(simultaneousHit.programs).toBe(baselinePrograms);
  expect(errors).toEqual([]);
});

test('render prewarming completes before the first flashlight interaction', async ({ page }) => {
  await page.goto('/?testState=flashlight-profile-off');
  await page.waitForFunction(() => Boolean(
    window.__THREE_GAME_TEST_HOOKS__
    && window.__THREE_GAME_DIAGNOSTICS__
    && window.__THREE_GAME_DIAGNOSTICS__.frame >= 2,
  ));
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setPausedForScreenshot(false));
  const pendingAssetUpgrades = await page.evaluate(
    () => window.__THREE_GAME_DIAGNOSTICS__?.world.pendingAssetUpgrades ?? -1,
  );

  const firstFlashlight = await measureTransition(page, 'flashlight-profile-on');
  console.log(JSON.stringify({ pendingAssetUpgrades, earlyFirstFlashlight: firstFlashlight }));
  expect(pendingAssetUpgrades).toBe(0);
  expect(firstFlashlight.maximumMs).toBeLessThan(MAX_TRANSITION_FRAME_MS);
});

test('flashlight post-process preserves non-beam scene luminance', async ({ page }) => {
  await openProfileState(page, 'flashlight-profile-off');
  await settleFrames(page, 12);
  const offRenderer = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.renderer);
  const off = PNG.sync.read(await page.locator('#game-canvas').screenshot());

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('flashlight-profile-on'));
  await settleFrames(page, 30);
  const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  console.log(JSON.stringify({ flashlightDiagnostics: diagnostics && {
    state: diagnostics.deterministicState,
    beams: diagnostics.world.beams,
    frame: diagnostics.frame,
    offRenderer,
    onRenderer: diagnostics.renderer,
    children: diagnostics.viewerFrame?.children.map((child) => ({
      id: child.playerId,
      flashlightOn: child.flashlightOn,
    })),
  } }));
  expect(diagnostics?.deterministicState).toBe('flashlight-profile-on');
  expect(diagnostics?.world.beams).toBe(1);
  await settleFrames(page, 6);
  const on = PNG.sync.read(await page.locator('#game-canvas').screenshot());
  const medianLumaDelta = medianSceneLumaDelta(off, on);

  console.log(JSON.stringify({ medianLumaDelta }));
  expect(medianLumaDelta).toBeLessThan(MAX_NON_BEAM_MEAN_LUMA_DELTA);
});

async function openProfileState(page: Page, state: string): Promise<void> {
  await page.goto(`/?testState=${state}`);
  await page.waitForFunction(
    (expectedState) => {
      const diagnostics = window.__THREE_GAME_DIAGNOSTICS__;
      return diagnostics?.deterministicState === expectedState
        && diagnostics.frame > 10
        && diagnostics.world.assets.kid.status === 'ready'
        && diagnostics.world.assets.ghost.status === 'ready'
        && diagnostics.world.pendingAssetUpgrades === 0;
    },
    state,
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.__THREE_GAME_TEST_HOOKS__?.hideDebugUi(true);
    window.__THREE_GAME_TEST_HOOKS__?.hideOverlay(true);
    window.__THREE_GAME_TEST_HOOKS__?.setPausedForScreenshot(false);
  });
  await settleFrames(page, 8);
}

async function measureTransition(page: Page, state: string): Promise<{
  maximumMs: number;
  medianMs: number;
  samplesMs: number[];
  programs: number;
}> {
  return page.evaluate(async (nextState) => new Promise((resolve) => {
    const samplesMs: number[] = [];
    let previous = performance.now();
    let frames = 0;
    const sample = (now: number) => {
      samplesMs.push(now - previous);
      previous = now;
      frames += 1;
      if (frames === 2) window.__THREE_GAME_TEST_HOOKS__?.setState(nextState);
      if (frames < 32) {
        requestAnimationFrame(sample);
        return;
      }
      const measured = samplesMs.slice(2);
      const sorted = [...measured].sort((left, right) => left - right);
      resolve({
        maximumMs: Math.max(...measured),
        medianMs: sorted[Math.floor(sorted.length / 2)],
        samplesMs: measured,
        programs: window.__THREE_GAME_DIAGNOSTICS__?.renderer.programs ?? -1,
      });
    };
    requestAnimationFrame(sample);
  }), state);
}

async function settleFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(async (frameCount) => new Promise<void>((resolve) => {
    let remaining = frameCount;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), count);
}

function medianSceneLumaDelta(off: PNG, on: PNG): number {
  const differences: number[] = [];
  for (let y = 0; y < off.height; y += 2) {
    for (let x = 0; x < off.width; x += 2) {
      const index = (y * off.width + x) * 4;
      const offLuma = luma(off.data, index);
      if (offLuma <= 5) continue;
      differences.push(Math.abs(offLuma - luma(on.data, index)));
    }
  }
  differences.sort((left, right) => left - right);
  return differences[Math.floor(differences.length / 2)] ?? 0;
}

function luma(data: Buffer, index: number): number {
  return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
}

function collectErrors(page: Page, errors: string[]): void {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
}
