import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audioRoot = path.join(projectRoot, 'public', 'assets', 'audio');
const outputPath = path.join(audioRoot, 'kenney', 'sfx-pack.json');
const audioDirectories = ['kenney', 'freesound'];
const files = (await Promise.all(audioDirectories.map(async (directory) =>
  (await readdir(path.join(audioRoot, directory)))
    .filter((file) => file.endsWith('.mp3'))
    .map((file) => ({ directory, file })),
))).flat().sort((left, right) =>
  `${left.directory}/${left.file}`.localeCompare(`${right.directory}/${right.file}`),
);

const samples = {};
for (const { directory, file } of files) {
  const assetPath = `assets/audio/${directory}/${file}`;
  samples[assetPath] = (await readFile(path.join(audioRoot, directory, file))).toString('base64');
}

await writeFile(outputPath, `${JSON.stringify({
  format: 'base64-audio-pack-v1',
  mimeType: 'audio/mpeg',
  samples,
})}\n`);

console.log(`Packed ${files.length} audio samples into ${path.relative(projectRoot, outputPath)}.`);
