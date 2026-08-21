import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveConfig } from 'vite';

test('Harmony release build disables browser source maps', async () => {
  const config = await resolveConfig({
    configFile: path.resolve('vite.config.ts'),
  }, 'build', 'harmony-release');

  assert.equal(config.build.sourcemap, false);
});

test('Harmony release command selects both web and native release modes', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assert.match(packageJson.scripts?.['build:harmony-release'] ?? '', /--mode harmony-release/);
  assert.match(packageJson.scripts?.['prototype:harmony:release'] ?? '', /--build-mode release/);
});
