import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { MovementIndicator } from '../../src/game/MovementIndicator';
import { createDeterministicViewerFrame } from '../../src/testing/DeterministicStates';

test('local intent reverses immediately even when the actor stays blocked and facing away', () => {
  const indicator = new MovementIndicator();
  const frame = createDeterministicViewerFrame('child-playing', 71);
  const own = frame.children.find((child) => child.playerId === frame.viewerPlayerId)!;
  own.facingRadians = 0;
  indicator.sync(frame, { x: 1, z: 0 });
  const position = indicator.root.position.clone();
  indicator.sync(frame, { x: -1, z: 0 });
  assert.equal(indicator.root.visible, true);
  assert.ok(indicator.root.position.equals(position));
  assert.equal(indicator.root.position.x, own.position.x);
  assert.equal(indicator.root.position.z, own.position.z);
  const direction = new Vector3(1, 0, 0).applyEuler(indicator.root.rotation);
  assert.ok(direction.distanceTo(new Vector3(-1, 0, 0)) < 1e-9);
  indicator.sync(frame, { x: 0, z: 1 });
  assert.ok(new Vector3(1, 0, 0).applyEuler(indicator.root.rotation)
    .distanceTo(new Vector3(0, 0, 1)) < 1e-9);
});

test('indicator hides on release, capture, match end, missing local actor and world clear', () => {
  const indicator = new MovementIndicator();
  const frame = createDeterministicViewerFrame('child-playing', 71);
  const moving = { x: 1, z: 0 };
  indicator.sync(frame, moving);
  assert.equal(indicator.root.visible, true);
  indicator.sync(frame, { x: 0, z: 0 });
  assert.equal(indicator.root.visible, false);
  for (const phase of ['capture-animation', 'ended'] as const) {
    indicator.sync({ ...frame, phase }, moving);
    assert.equal(indicator.root.visible, false);
  }
  indicator.sync({ ...frame, phase: 'protection' }, moving);
  assert.equal(indicator.root.visible, true);
  indicator.sync({ ...frame, viewerPlayerId: 'missing' }, moving);
  assert.equal(indicator.root.visible, false);
  indicator.sync(null, moving);
  assert.equal(indicator.root.visible, false);
});

test('ghost viewer uses its own position and never attaches to a child', () => {
  const indicator = new MovementIndicator();
  const frame = createDeterministicViewerFrame('ghost-playing', 71);
  indicator.sync(frame, { x: 0, z: -1 });
  assert.equal(indicator.root.visible, true);
  assert.equal(indicator.root.position.x, frame.ghost!.position.x);
  assert.equal(indicator.root.position.z, frame.ghost!.position.z);
});
