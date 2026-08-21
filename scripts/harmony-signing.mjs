import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(repositoryRoot, 'prototypes/harmony-gate-a');
const buildProfilePath = resolve(projectRoot, 'build-profile.json5');
const localSigningPath = resolve(
  projectRoot,
  process.env.HARMONY_SIGNING_CONFIG ?? 'signing/local-signing.cjs',
);
const command = process.argv[2] ?? 'check';

if (command === 'check') {
  if (!existsSync(localSigningPath)) {
    fail(
      `HarmonyOS signing is not configured. Create ${display(localSigningPath)} from signing/local-signing.example.cjs.`,
    );
  }
  console.log(`HarmonyOS local signing config: ${display(localSigningPath)}`);
} else if (command === 'capture') {
  const buildProfile = readFileSync(buildProfilePath, 'utf8');
  const requiredFields = ['signingConfigs', 'storeFile', 'storePassword', 'keyAlias', 'keyPassword'];
  const missingFields = requiredFields.filter((field) => !buildProfile.includes(field));
  if (missingFields.length > 0 || /signingConfigs\s*:\s*\[\s*\]/.test(buildProfile)) {
    fail(
      'build-profile.json5 has no generated signing material. Run devecocli signature generate first.',
    );
  }
  const force = process.argv.includes('--force');
  if (existsSync(localSigningPath) && !force) {
    fail(`Refusing to overwrite ${display(localSigningPath)}. Pass --force after backing it up.`);
  }
  writeFileSync(localSigningPath, `module.exports = ${buildProfile.trim()}\n`, {
    encoding: 'utf8',
    flag: force ? 'w' : 'wx',
    mode: 0o600,
  });
  console.log(`Captured local HarmonyOS signing config: ${display(localSigningPath)}`);
  console.log('Restore the tracked build-profile.json5 before committing changes.');
} else {
  fail(`Unknown command: ${command}. Use check or capture.`);
}

function display(path) {
  return relative(repositoryRoot, path).replaceAll('\\', '/');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
