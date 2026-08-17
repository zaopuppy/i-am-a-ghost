import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const options = parseArgs(process.argv.slice(2));
const outputDirectory = path.resolve(options.outputDirectory);
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));

let report;
try {
  await page.goto(options.url, { waitUntil: 'networkidle', timeout: 20_000 });
  await page.waitForSelector('#game-canvas', { state: 'visible' });
  await page.waitForFunction(
    () => {
      const diagnostics = window.__THREE_GAME_DIAGNOSTICS__;
      return Boolean(diagnostics && diagnostics.frame > 10 && diagnostics.networkConnected);
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

  const screenshotPath = path.join(outputDirectory, 'desktop-foundation.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  report = {
    result: errors.length === 0 && pixelStats.lumaRange > 20 ? 'pass' : 'fail',
    url: options.url,
    viewport: { width: 1280, height: 720 },
    canvas: canvasMetrics,
    pixels: pixelStats,
    diagnostics,
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
