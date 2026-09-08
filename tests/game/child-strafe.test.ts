import assert from 'node:assert/strict';
import test from 'node:test';
import { strafeFootTarget } from '../../src/game/ChildStrafeAnimation';

test('planted foot offsets cancel body travel during the stance half of each stride', () => {
  const before = strafeFootTarget(0.1);
  const after = strafeFootTarget(0.2);
  assert.ok(Math.abs(after.travel - before.travel + 0.06) < 1e-8);
  assert.equal(before.lift, 0);
  assert.equal(after.lift, 0);
});

test('alternate foot lifts during recovery and wraps without jumping', () => {
  assert.equal(strafeFootTarget(0.25).lift, 0);
  assert.ok(strafeFootTarget(0.75).lift > 0.08);
  assert.ok(Math.abs(strafeFootTarget(1 - 1e-6).travel - strafeFootTarget(0).travel) < 1e-6);
  assert.ok(strafeFootTarget(1 - 1e-6).lift < 1e-6);
});
