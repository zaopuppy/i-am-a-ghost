import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { GAME_AUDIO_ASSETS, GAME_AUDIO_PACK_PATH } from '../../src/audio/GameAudio';

test('runtime model and audio assets are present with copied CC0 licenses', () => {
  assert.equal(statSync('public/assets/models/kaykit-adventurers/Rogue_Kid.glb').size, 503_252);
  assert.equal(statSync('public/assets/models/kaykit-adventurers/Ghost.glb').size, 445_612);
  assert.equal(statSync('public/assets/models/kaykit-medieval/wall_straight.glb').size, 28_752);
  for (const relativePath of Object.values(GAME_AUDIO_ASSETS)) {
    assert.ok(statSync(`public/${relativePath}`).size > 1_000, `${relativePath} should contain audio data`);
  }
  const pack = JSON.parse(readFileSync(`public/${GAME_AUDIO_PACK_PATH}`, 'utf8')) as {
    format: string;
    mimeType: string;
    samples: Record<string, string>;
  };
  assert.equal(pack.format, 'base64-audio-pack-v1');
  assert.equal(pack.mimeType, 'audio/mpeg');
  assert.deepEqual(Object.keys(pack.samples).sort(), Object.values(GAME_AUDIO_ASSETS).sort());
  for (const relativePath of Object.values(GAME_AUDIO_ASSETS)) {
    assert.deepEqual(
      Buffer.from(pack.samples[relativePath], 'base64'),
      readFileSync(`public/${relativePath}`),
      `${relativePath} should match its packed sample`,
    );
  }
  for (const licensePath of [
    'public/assets/models/kaykit-adventurers/LICENSE.txt',
    'public/assets/models/kaykit-medieval/LICENSE.txt',
    'public/assets/audio/kenney/LICENSE-interface-sounds.txt',
    'public/assets/audio/kenney/LICENSE-impact-sounds.txt',
    'public/assets/audio/freesound/LICENSE-CC0-1.0.txt',
  ]) {
    assert.match(readFileSync(licensePath, 'utf8'), /Creative Commons Zero|CC0/i);
  }
});

test('original Blender characters ship editable sources, rigs, and required clips', () => {
  for (const [name, prefix] of [['Night_Scout', 'Scout'], ['Old_House_Wraith', 'Wraith']] as const) {
    assert.ok(statSync(`assets/models/original/${name}.blend`).size > 10_000);
    const glb = readFileSync(`public/assets/models/original/${name}.glb`);
    assert.equal(glb.toString('ascii', 0, 4), 'glTF');
    const jsonLength = glb.readUInt32LE(12);
    const document = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength)) as {
      animations: Array<{ name: string }>;
      nodes: Array<{ name?: string }>;
      skins: unknown[];
    };
    assert.equal(document.skins.length, 1);
    assert.deepEqual(document.animations.map((clip) => clip.name), ['Idle_A', 'Running_A', 'Hit_A']);
    const names = new Set(document.nodes.map((node) => node.name));
    for (const joint of ['Torso', 'Skull', 'ArmUpperL', 'ArmUpperR', 'ArmLowerL', 'ArmLowerR',
      'LegUpperL', 'LegUpperR', 'LegLowerL', 'LegLowerR', 'TorchSocketR', 'FootL', 'FootR']) {
      assert.ok(names.has(`${prefix}_${joint}`), `${name} needs ${joint}`);
    }
  }
});
