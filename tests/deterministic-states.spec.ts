import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

const VISUAL_STATES = [
  'child-playing',
  'flashlight-off-range',
  'flashlight-wall',
  'ghost-playing',
  'low-battery',
  'capture',
  'child-win',
] as const;

for (const state of VISUAL_STATES) {
  test(`${state} deterministic visual baseline`, async ({ page }) => {
    const errors: string[] = [];
    collectErrors(page, errors);
    await openState(page, state);

    const png = PNG.sync.read(await page.locator('#game-canvas').screenshot());
    expect(lumaRange(png)).toBeGreaterThan(20);
    if (state === 'flashlight-off-range') {
      expect(illuminatedPixelRatio(png, 0.55, 0.47, 0.67, 0.57)).toBeGreaterThan(0.04);
      const nearSpan = illuminatedColumnSpan(png, 0.525, 0.42, 0.59);
      const farSpan = illuminatedColumnSpan(png, 0.56, 0.42, 0.59);
      expect(farSpan).toBeGreaterThan(nearSpan);
    }
    if (state === 'ghost-playing') {
      const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
      expect(diagnostics?.world.assets.ghost).toMatchObject({
        status: 'ready',
        fileBytes: 445_612,
        triangles: 7_185,
        meshes: 8,
        materials: 1,
        textures: 1,
      });
      expect(diagnostics?.world.assets.ghost.clips).toEqual(
        expect.arrayContaining(['Idle_A', 'Running_A', 'Hit_A']),
      );
      expect(diagnostics?.world.animatedActors).toBe(5);
      await expect(page.locator('#control-hint')).toContainText('接触孩子自动抓取');
      await expect(page.getByTestId('event-banner')).toBeHidden();
    }
    if (state === 'capture') {
      const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
      expect(diagnostics?.cameraMode).toBe('capture-closeup');
      expect(diagnostics?.cameraViewHeight).toBeCloseTo(5.2, 3);
      expect(diagnostics?.camera.pointerMode).toBe(false);
      expect(diagnostics?.camera.relativePosition).toEqual(
        diagnostics?.tuning.cameraPresets['capture-closeup'].position,
      );
      expect(diagnostics?.camera.relativeTarget).toEqual(
        diagnostics?.tuning.cameraPresets['capture-closeup'].target,
      );
      expect(diagnostics?.capturedChildPlayerId).toBe('child-1');
      const frame = diagnostics?.viewerFrame;
      expect(frame?.viewerRole).toBe('child');
      if (frame?.viewerRole === 'child') expect(frame.ghost).toBeDefined();
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

test('capture presentation advances from impact through struggle to tightening without wall-clock timing', async ({ page }) => {
  await openState(page, 'capture');
  const samples = await page.evaluate(async () => {
    type CaptureFrame = {
      capture: { ticksRemaining: number; durationTicks: number } | null;
    };
    type ActorProbe = {
      root: { position: { y: number } };
      bodyPivot: { rotation: { x: number; z: number } };
      ghostRig: {
        leftShoulder: { rotation: { z: number } };
        captureAura: { material: { opacity: number } };
      } | null;
    };
    type WorldProbe = {
      actors: Map<string, ActorProbe>;
      sync(frame: unknown, elapsedSeconds: number): void;
      dispose(): void;
    };
    const loadModule = (specifier: string): Promise<Record<string, unknown>> => import(specifier);
    const worldModule = await loadModule('/src/game/GameWorld.ts') as {
      GameWorld: new () => WorldProbe;
    };
    const stateModule = await loadModule('/src/testing/DeterministicStates.ts') as {
      createDeterministicViewerFrame(state: string, seed: number): CaptureFrame;
    };
    const world = new worldModule.GameWorld();
    document.documentElement.dataset.reducedMotion = 'false';

    const sample = (requestedProgress: number) => {
      const frame = structuredClone(stateModule.createDeterministicViewerFrame('capture', 71));
      if (!frame.capture) throw new Error('Capture fixture is missing capture timing.');
      frame.capture.ticksRemaining = Math.round(
        frame.capture.durationTicks * (1 - requestedProgress),
      );
      const actualProgress = 1 - frame.capture.ticksRemaining / frame.capture.durationTicks;
      world.sync(frame, actualProgress * frame.capture.durationTicks / 60);
      const child = world.actors.get('child:child-1');
      const ghost = world.actors.get('ghost');
      if (!child || !ghost?.ghostRig) throw new Error('Capture actors were not created.');
      return {
        progress: actualProgress,
        childPitch: child.bodyPivot.rotation.x,
        childRoll: child.bodyPivot.rotation.z,
        childHeight: child.root.position.y,
        shoulderGrip: ghost.ghostRig.leftShoulder.rotation.z,
        auraOpacity: ghost.ghostRig.captureAura.material.opacity,
      };
    };

    const result = {
      impact: sample(0.03),
      struggle: sample(0.45),
      tighten: sample(0.95),
    };
    world.dispose();
    return result;
  });

  expect(samples.impact.progress).toBeLessThan(0.06);
  expect(samples.impact.childPitch).toBeLessThan(-0.15);
  expect(Math.abs(samples.impact.childRoll)).toBeLessThan(0.001);

  expect(samples.struggle.progress).toBeGreaterThan(0.4);
  expect(Math.abs(samples.struggle.childRoll)).toBeGreaterThan(0.04);
  expect(samples.struggle.childHeight).not.toBeCloseTo(samples.impact.childHeight, 3);

  expect(samples.tighten.progress).toBeGreaterThan(0.9);
  expect(samples.tighten.childPitch).toBeGreaterThan(0.08);
  expect(Math.abs(samples.tighten.childRoll)).toBeLessThan(Math.abs(samples.struggle.childRoll));
  expect(samples.impact.shoulderGrip).toBeLessThan(samples.struggle.shoulderGrip);
  expect(samples.struggle.shoulderGrip).toBeLessThan(samples.tighten.shoulderGrip);
  expect(samples.struggle.auraOpacity).toBeGreaterThan(samples.impact.auraOpacity);
  expect(samples.struggle.auraOpacity).toBeGreaterThan(samples.tighten.auraOpacity);
});

test('laptop PC viewport keeps the HUD bands separated and visible', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openState(page, 'low-battery');
  const batteryLocator = page.getByTestId('battery-locator');
  await expect(batteryLocator).toBeVisible();
  await expect(batteryLocator).toHaveAttribute('data-offscreen', 'true');
  await expect(batteryLocator).toContainText(/\d+m/);
  const layout = await page.evaluate(() => {
    const role = document.querySelector('.hud-role-block')?.getBoundingClientRect();
    const objective = document.querySelector('.hud-objective')?.getBoundingClientRect();
    const captures = document.querySelector('.hud-captures')?.getBoundingClientRect();
    const battery = document.querySelector('#battery-meter')?.getBoundingClientRect();
    const audio = document.querySelector('#audio-toggle')?.getBoundingClientRect();
    const locator = document.querySelector('#battery-locator')?.getBoundingClientRect();
    return { role, objective, captures, battery, audio, locator };
  });
  expect(layout.role?.right ?? 0).toBeLessThan(layout.objective?.left ?? 0);
  expect(layout.objective?.right ?? 0).toBeLessThan(layout.captures?.left ?? 0);
  expect(layout.battery?.right ?? 2000).toBeLessThanOrEqual(1024);
  expect(layout.battery?.bottom ?? 2000).toBeLessThanOrEqual(768);
  expect(layout.locator?.left ?? -1).toBeGreaterThanOrEqual(0);
  expect(layout.locator?.top ?? -1).toBeGreaterThanOrEqual(150);
  expect(layout.locator?.right ?? 2000).toBeLessThanOrEqual(1024);
  expect(layout.locator?.bottom ?? 2000).toBeLessThanOrEqual(768);
  expect(rectanglesOverlap(layout.locator, layout.battery)).toBe(false);
  expect(rectanglesOverlap(layout.locator, layout.audio)).toBe(false);
});

function rectanglesOverlap(
  left: { left: number; right: number; top: number; bottom: number } | undefined,
  right: { left: number; right: number; top: number; bottom: number } | undefined,
): boolean {
  if (!left || !right) return false;
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top;
}

async function openState(page: Page, state: string): Promise<void> {
  await page.goto(`/?testState=${state}`);
  await page.waitForFunction(
    (expectedState) => {
      const diagnostics = window.__THREE_GAME_DIAGNOSTICS__;
      const frameHasGhost = diagnostics?.viewerFrame
        && 'ghost' in diagnostics.viewerFrame
        && diagnostics.viewerFrame.ghost !== undefined;
      return diagnostics?.deterministicState === expectedState
        && diagnostics.frame > 10
        && diagnostics.world.assets.kid.status === 'ready'
        && (!frameHasGhost || diagnostics.world.assets.ghost.status === 'ready')
        && diagnostics.world.assets.wall.status === 'ready'
        && diagnostics.world.pendingAssetUpgrades === 0;
    },
    state,
  );
  const frameBeforeStabilizing = await page.evaluate(async () => {
    await document.fonts.ready;
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    if (!hooks) throw new Error('Deterministic test hooks are missing.');
    hooks.seed(71);
    hooks.setPausedForScreenshot(true);
    hooks.setReducedMotion(true);
    hooks.hideDebugUi(true);
    return window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0;
  });
  await page.waitForFunction(
    (previousFrame) => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) >= previousFrame + 2,
    frameBeforeStabilizing,
  );
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

function illuminatedPixelRatio(
  png: PNG,
  leftRatio: number,
  topRatio: number,
  rightRatio: number,
  bottomRatio: number,
): number {
  const left = Math.floor(png.width * leftRatio);
  const top = Math.floor(png.height * topRatio);
  const right = Math.ceil(png.width * rightRatio);
  const bottom = Math.ceil(png.height * bottomRatio);
  let illuminatedPixels = 0;
  let totalPixels = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = (y * png.width + x) * 4;
      const luma =
        png.data[index] * 0.2126 +
        png.data[index + 1] * 0.7152 +
        png.data[index + 2] * 0.0722;
      if (luma > 12) illuminatedPixels += 1;
      totalPixels += 1;
    }
  }
  return illuminatedPixels / Math.max(1, totalPixels);
}

function illuminatedColumnSpan(
  png: PNG,
  xRatio: number,
  topRatio: number,
  bottomRatio: number,
): number {
  const x = Math.round(png.width * xRatio);
  const top = Math.floor(png.height * topRatio);
  const bottom = Math.ceil(png.height * bottomRatio);
  let first = -1;
  let last = -1;
  for (let y = top; y < bottom; y += 1) {
    const index = (y * png.width + x) * 4;
    const luma =
      png.data[index] * 0.2126 +
      png.data[index + 1] * 0.7152 +
      png.data[index + 2] * 0.0722;
    if (luma <= 20) continue;
    if (first < 0) first = y;
    last = y;
  }
  return first < 0 ? 0 : last - first + 1;
}
