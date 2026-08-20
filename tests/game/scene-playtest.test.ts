import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_HOUSE_MAP } from '../../src/game/defaultHouse';
import { ScenePlaytest } from '../../src/game/ScenePlaytest';

test('scene playtest runs authoritative movement from the selected role spawn', () => {
  const playtest = new ScenePlaytest(DEFAULT_HOUSE_MAP, 'ghost');
  const initial = playtest.frame();
  assert.equal(initial.viewerRole, 'ghost');
  assert.deepEqual(initial.ghost.position, DEFAULT_HOUSE_MAP.ghostSpawn);

  const moved = playtest.update(1 / 60, { x: 1, z: 0 }, 0, false);
  assert.ok(moved.ghost.position.x > initial.ghost.position.x);
  assert.equal(moved.ghost.position.z, initial.ghost.position.z);
});

test('child scene playtest exposes real flashlight state and can reset the draft run', () => {
  const playtest = new ScenePlaytest(DEFAULT_HOUSE_MAP, 'child');
  const active = playtest.update(1 / 60, { x: 1, z: 0 }, 0, true);
  assert.equal(active.viewerRole, 'child');
  assert.equal(active.children[0]?.flashlightOn, true);
  assert.ok(active.children[0].position.x > DEFAULT_HOUSE_MAP.childSpawns[0].x);

  playtest.reset();
  const reset = playtest.frame();
  assert.deepEqual(reset.children[0]?.position, DEFAULT_HOUSE_MAP.childSpawns[0]);
  assert.equal(reset.children[0]?.flashlightOn, false);
});
