import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { GAME_AUDIO_ASSETS } from '../../src/audio/GameAudio';

test('runtime model and audio assets are present with copied CC0 licenses', () => {
  assert.equal(statSync('public/assets/models/kaykit-adventurers/Rogue_Kid.glb').size, 503_252);
  assert.equal(statSync('public/assets/models/kaykit-medieval/wall_straight.glb').size, 28_752);
  for (const relativePath of Object.values(GAME_AUDIO_ASSETS)) {
    assert.ok(statSync(`public/${relativePath}`).size > 1_000, `${relativePath} should contain audio data`);
  }
  for (const licensePath of [
    'public/assets/models/kaykit-adventurers/LICENSE.txt',
    'public/assets/models/kaykit-medieval/LICENSE.txt',
    'public/assets/audio/kenney/LICENSE-interface-sounds.txt',
    'public/assets/audio/kenney/LICENSE-impact-sounds.txt',
  ]) {
    assert.match(readFileSync(licensePath, 'utf8'), /Creative Commons Zero|CC0/i);
  }
});
