import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DETERMINISTIC_STATE_NAMES,
  createDeterministicViewerFrame,
} from '../../src/testing/DeterministicStates';

test('every deterministic browser state is stable and internally valid', () => {
  for (const state of DETERMINISTIC_STATE_NAMES) {
    const left = createDeterministicViewerFrame(state, 71);
    const right = createDeterministicViewerFrame(state, 71);
    assert.deepEqual(left, right);
    assert.equal(left.tick >= 0, true);
    assert.equal(left.children.length + left.dolls.length, 4);
  }
});

test('hidden-child test state contains no ghost coordinate', () => {
  const frame = createDeterministicViewerFrame('child-hidden', 17);
  assert.equal(frame.viewerRole, 'child');
  if (frame.viewerRole !== 'child') throw new Error('Expected child frame.');
  assert.equal(frame.ghost, undefined);
  assert.doesNotMatch(JSON.stringify(frame), /"ghost"/);
});
