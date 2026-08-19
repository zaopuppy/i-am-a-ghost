import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const options = parseArgs(process.argv.slice(2));
const outputDirectory = path.resolve(options.outputDirectory);
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const host = await context.newPage();
const guest = await context.newPage();
const errors = [];
collectErrors(host, 'host', errors);
collectErrors(guest, 'guest', errors);

let report;
try {
  await Promise.all([
    host.goto(options.url, { waitUntil: 'networkidle', timeout: 20_000 }),
    guest.goto(options.url, { waitUntil: 'networkidle', timeout: 20_000 }),
  ]);
  await host.getByTestId('create-room').click();
  await host.waitForFunction(() => document.querySelector('[data-testid="room-code"]')?.textContent !== '——');
  const roomCode = (await host.getByTestId('room-code').textContent())?.trim();
  if (!roomCode) throw new Error('Room code was not created.');
  await guest.getByTestId('room-code-input').fill(roomCode);
  await guest.getByTestId('join-room').click();
  await host.getByTestId('roster').locator('li').nth(1).waitFor();
  await host.getByTestId('start-match').click();
  await Promise.all([host, guest].map((candidate) => candidate.waitForFunction(
    () => {
      const diagnostics = window.__THREE_GAME_DIAGNOSTICS__;
      return Boolean(
        diagnostics
        && diagnostics.networkConnected
        && diagnostics.role
        && diagnostics.serverTick !== null
        && diagnostics.serverTick > 6
        && diagnostics.world.assets.kid.status === 'ready'
        && diagnostics.world.assets.furniture.status === 'ready',
      );
    },
    undefined,
    { timeout: 20_000 },
  )));
  const hostRole = await host.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.role);
  const page = hostRole === 'ghost' ? host : guest;
  const backgroundPage = page === host ? guest : host;
  const backgroundSession = await context.newCDPSession(backgroundPage);
  await backgroundSession.send('Page.setWebLifecycleState', { state: 'frozen' });
  await page.bringToFront();
  await page.waitForTimeout(1_200);
  await page.waitForFunction(
    () => {
      const diagnostics = window.__THREE_GAME_DIAGNOSTICS__;
      return Boolean(diagnostics && diagnostics.fps > 0 && diagnostics.renderer.calls > 0);
    },
    undefined,
    { timeout: 15_000 },
  );

  const canvas = page.locator('#game-canvas');
  const canvasPng = PNG.sync.read(await canvas.screenshot());
  const pixelStats = samplePixels(canvasPng);
  const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  const canvasMetrics = await page.evaluate(() => {
    const element = document.querySelector('#game-canvas');
    if (!(element instanceof HTMLCanvasElement)) return null;
    return {
      cssWidth: element.clientWidth,
      cssHeight: element.clientHeight,
      bufferWidth: element.width,
      bufferHeight: element.height,
    };
  });
  const gpu = await page.evaluate(() => {
    const canvas = document.querySelector('#game-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return null;
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = extension
      ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    const vendor = extension
      ? String(gl.getParameter(extension.UNMASKED_VENDOR_WEBGL))
      : String(gl.getParameter(gl.VENDOR));
    return {
      renderer,
      vendor,
      softwareRendered: /swiftshader|llvmpipe|software/i.test(renderer),
    };
  });

  const budgets = rendererBudgets(diagnostics);
  const screenshotPath = path.join(outputDirectory, 'desktop-active-match.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  report = {
    result: errors.length === 0
      && pixelStats.lumaRange > 20
      && diagnostics?.role === 'ghost'
      && Object.values(budgets).every((budget) => budget.pass)
      ? 'pass'
      : 'fail',
    url: options.url,
    roomCode,
    state: 'live-two-player-match',
    viewport: { width: 1280, height: 720 },
    canvas: canvasMetrics,
    pixels: pixelStats,
    diagnostics,
    gpu,
    budgets,
    errors,
    screenshot: screenshotPath,
  };
} catch (error) {
  report = {
    result: 'fail',
    url: options.url,
    errors: [...errors, error instanceof Error ? error.message : String(error)],
  };
} finally {
  await browser.close();
}
const reportPath = path.join(outputDirectory, 'report.json');
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (report.result !== 'pass') process.exitCode = 1;

function parseArgs(args) {
  const parsed = {
    url: 'http://127.0.0.1:5189',
    outputDirectory: 'artifacts/canvas-inspection',
  };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--url' && args[index + 1]) parsed.url = args[++index];
    if (args[index] === '--out' && args[index + 1]) parsed.outputDirectory = args[++index];
  }
  return parsed;
}

function samplePixels(png) {
  let minLuma = 255;
  let maxLuma = 0;
  let opaqueSamples = 0;
  const stride = 4 * 97;
  for (let index = 0; index < png.data.length; index += stride) {
    const alpha = png.data[index + 3];
    if (alpha === 0) continue;
    opaqueSamples += 1;
    const luma = Math.round(
      png.data[index] * 0.2126 + png.data[index + 1] * 0.7152 + png.data[index + 2] * 0.0722,
    );
    minLuma = Math.min(minLuma, luma);
    maxLuma = Math.max(maxLuma, luma);
  }
  return {
    opaqueSamples,
    minLuma,
    maxLuma,
    lumaRange: maxLuma - minLuma,
  };
}

function rendererBudgets(diagnostics) {
  const renderer = diagnostics?.renderer ?? {};
  const world = diagnostics?.world ?? {};
  return {
    fps: minimumBudget(diagnostics?.fps, 50),
    calls: budget(renderer.calls, 300),
    triangles: budget(renderer.triangles, 750_000),
    geometries: budget(renderer.geometries, 300),
    materials: budget(world.materials, 80),
    textures: budget(renderer.textures, 60),
  };
}

function budget(value, limit) {
  return { value: value ?? null, limit, pass: Number.isFinite(value) && value <= limit };
}

function minimumBudget(value, minimum) {
  return { value: value ?? null, minimum, pass: Number.isFinite(value) && value >= minimum };
}

function collectErrors(page, label, target) {
  page.on('console', (message) => {
    if (message.type() === 'error') target.push(`${label} console: ${message.text()}`);
  });
  page.on('pageerror', (error) => target.push(`${label} page: ${error.message}`));
}
