import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audioDirectory = path.join(projectRoot, 'public', 'assets', 'audio', 'kenney');
const outputPath = path.join(audioDirectory, 'sfx-pack.json');
const files = (await readdir(audioDirectory))
  .filter((file) => file.endsWith('.mp3'))
  .sort();

const samples = {};
for (const file of files) {
  const assetPath = `assets/audio/kenney/${file}`;
  samples[assetPath] = (await readFile(path.join(audioDirectory, file))).toString('base64');
}

await writeFile(outputPath, `${JSON.stringify({
  format: 'base64-audio-pack-v1',
  mimeType: 'audio/mpeg',
  samples,
})}\n`);

console.log(`Packed ${files.length} audio samples into ${path.relative(projectRoot, outputPath)}.`);
