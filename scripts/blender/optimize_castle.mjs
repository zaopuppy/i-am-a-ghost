import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(root, 'public/assets/models/midnight-castle/midnight-castle.glb');
const output = path.join(root, 'tmp/castle-compressed.glb');
const promoteStaged = process.argv.slice(2).includes('--promote-staged');
if (process.argv.slice(2).some((argument) => argument !== '--promote-staged')) {
  throw new Error('The only supported argument is --promote-staged.');
}
const before = readGlb(await readFile(source));
if (before.json.extensionsUsed?.includes('EXT_meshopt_compression')) {
  console.log(`CASTLE_OPTIMIZE already compressed: ${before.bytes} bytes`);
} else {
  await mkdir(path.dirname(output), { recursive: true });
  if (!promoteStaged) {
    const command = await npxCommand();
    await run(command.executable, [...command.prefix, '--yes', '@gltf-transform/cli@4.5.1',
      'meshopt', source, output, '--level', 'high',
      '--quantize-position', '16', '--quantize-normal', '12', '--quantize-texcoord', '14']);
  }
  const after = readGlb(await readFile(output));
  validatePreservedScene(before.json, after.json);
  if (after.bytes >= before.bytes) throw new Error('Meshopt output is not smaller; the original castle GLB was retained.');
  // Both files live in the same repository/volume. Promote only after a
  // successful compressor process and complete validation, with a recoverable
  // original backup when Windows refuses replacement of an existing file.
  await promoteOutput();
  console.log(`CASTLE_OPTIMIZE ${before.bytes} -> ${after.bytes} bytes (${Math.round((1 - after.bytes / before.bytes) * 100)}% smaller)`);
}

async function promoteOutput() {
  try {
    await rename(output, source);
    return;
  } catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EEXIST', 'EACCES'].includes(error.code)) throw error;
  }
  const backupDirectory = await mkdtemp(path.join(root, 'tmp/castle-promotion-'));
  const backup = path.join(backupDirectory, 'original.glb');
  // Exact, previously-read targets stay inside this repository. Moving the
  // original instead of deleting it allows recovery even if promotion fails.
  await rename(source, backup);
  try {
    await rename(output, source);
  } catch (promotionError) {
    try {
      await rename(backup, source);
    } catch (rollbackError) {
      throw new Error(`Castle promotion failed and rollback failed. Original is recoverable at ${backup}.`,
        { cause: new AggregateError([promotionError, rollbackError]) });
    }
    throw new Error('Castle promotion failed. The original GLB was restored.', { cause: promotionError });
  }
  console.log(`CASTLE_OPTIMIZE original backup: ${backup}`);
}

function readGlb(buffer) {
  if (buffer.length < 28 || buffer.readUInt32LE(0) !== 0x46546c67
      || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) {
    throw new Error('Castle optimization requires a valid complete GLB 2.0 file.');
  }
  let json;
  let binary = false;
  let offset = 12;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) throw new Error('Truncated castle GLB chunk header.');
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const end = offset + 8 + length;
    if (length % 4 || end > buffer.length) throw new Error('Invalid castle GLB chunk length.');
    if (type === 0x4e4f534a) {
      if (json || offset !== 12) throw new Error('Castle GLB must have exactly one leading JSON chunk.');
      json = JSON.parse(buffer.subarray(offset + 8, end).toString('utf8'));
    } else if (type === 0x004e4942) {
      binary = true;
    }
    offset = end;
  }
  if (!json || !binary || json.asset?.version !== '2.0' || !json.meshes?.length) {
    throw new Error('Optimized castle GLB lost its scene or binary geometry.');
  }
  return { json, bytes: buffer.length };
}

function validatePreservedScene(beforeJson, afterJson) {
  if (!afterJson.extensionsRequired?.includes('EXT_meshopt_compression')
      || !afterJson.bufferViews?.some((view) => view.extensions?.EXT_meshopt_compression)) {
    throw new Error('Castle output did not contain required Meshopt-compressed geometry.');
  }
  const namedNodes = new Map((afterJson.nodes ?? []).map((node) => [node.name, node]));
  for (const node of beforeJson.nodes ?? []) {
    if (!node.name) continue;
    const preserved = namedNodes.get(node.name);
    if (!preserved) throw new Error(`Castle compression removed named node: ${node.name}`);
    if (JSON.stringify(node.extras ?? null) !== JSON.stringify(preserved.extras ?? null)) {
      throw new Error(`Castle compression changed proxy/scene metadata: ${node.name}`);
    }
  }
  for (const mesh of beforeJson.meshes ?? []) {
    if (!mesh.name?.startsWith('wall-') && !mesh.name?.startsWith('boundary-')) continue;
    if (!afterJson.meshes?.some((candidate) => candidate.name === mesh.name)) {
      throw new Error(`Castle compression removed a shadow occluder: ${mesh.name}`);
    }
  }
  for (const property of ['images', 'textures', 'materials']) {
    if ((beforeJson[property]?.length ?? 0) !== (afterJson[property]?.length ?? 0)) {
      throw new Error(`Castle compression unexpectedly changed ${property}; original retained.`);
    }
  }
  for (const buffer of afterJson.buffers ?? []) {
    if (buffer.uri) throw new Error('Compressed castle must remain a self-contained GLB.');
  }
}

async function npxCommand() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js'),
    process.env.npm_execpath?.replace(/npm-cli\.js$/, 'npx-cli.js'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { executable: process.execPath, prefix: [candidate] };
  }
  if (process.platform !== 'win32') return { executable: 'npx', prefix: [] };
  const located = await capture('where.exe', ['npx']);
  for (const candidate of located.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    const cli = path.join(path.dirname(candidate), 'node_modules/npm/bin/npx-cli.js');
    if (existsSync(cli)) return { executable: process.execPath, prefix: [cli] };
    // Nodist provides a native npx.exe shim. Spawn it directly with structured
    // arguments, avoiding cmd interpolation and paths with spaces altogether.
    if (candidate.toLowerCase().endsWith('.exe')) return { executable: candidate, prefix: [] };
  }
  throw new Error('A directly executable npx or npm npx-cli.js could not be found.');
}

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Castle compressor exited with code ${code}. Original retained.`)));
  });
}

function capture(executable, args) {
  return new Promise((resolve, reject) => {
    let outputText = '';
    const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => { outputText += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve(outputText) : reject(new Error('npx lookup failed.')));
  });
}
