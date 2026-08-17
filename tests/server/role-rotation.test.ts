import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseNextGhost } from '../../server/RoleRotation';

test('the first ghost is selected from the supplied random index', () => {
  assert.equal(chooseNextGhost(['a', 'b', 'c'], null, 2), 'c');
});

test('later rounds rotate the ghost through the stable room roster', () => {
  assert.equal(chooseNextGhost(['a', 'b', 'c'], 'a', 0), 'b');
  assert.equal(chooseNextGhost(['a', 'b', 'c'], 'c', 0), 'a');
  assert.equal(chooseNextGhost(['a', 'b', 'c'], 'missing', 1), 'b');
});
