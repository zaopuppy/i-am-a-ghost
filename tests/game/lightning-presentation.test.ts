import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceLightningPresentation,
  createLightningPresentationState,
  lightningSourceVector,
} from '../../src/game/LightningPresentation';
import type { LightningStrike } from '../../src/game/MatchEngine';

const STRIKE: LightningStrike = {
  id: 7,
  startTick: 100,
  direction: 'east',
  pulses: [
    { kind: 'preflash', startTick: 100, durationTicks: 6 },
    { kind: 'main', startTick: 112, durationTicks: 12 },
  ],
  thunderTick: 142,
  thunderVariant: 2,
};

test('lightning uses a smooth temporal envelope without spatial attenuation data', () => {
  const state = createLightningPresentationState();
  const start = advanceLightningPresentation(state, STRIKE, 100, 10);
  const peak = advanceLightningPresentation(state, STRIKE, 100, 10.05);
  advanceLightningPresentation(state, STRIKE, 106, 10.1);
  const gap = advanceLightningPresentation(state, STRIKE, 109, 10.15);

  assert.equal(start.intensity, 0);
  assert.equal(start.pulseKind, 'preflash');
  assert.ok(peak.intensity > 0.7 && peak.intensity <= 0.72);
  assert.equal(gap.intensity, 0);
  assert.equal(gap.pulseKind, null);
});

test('main pulse reaches full strength and exposes its thunder delay', () => {
  const state = createLightningPresentationState();
  const frame = advanceLightningPresentation(state, STRIKE, 118, 20);

  assert.equal(frame.intensity, 1);
  assert.equal(frame.pulseKind, 'main');
  assert.equal(frame.thunderDelayTicks, 18);
  assert.equal(frame.thunderVariant, 2);
});

test('thunder becomes due exactly once when the visual clock crosses its tick', () => {
  const state = createLightningPresentationState();
  advanceLightningPresentation(state, STRIKE, 140, 30);
  const due = advanceLightningPresentation(state, STRIKE, 140, 30.05);
  const repeated = advanceLightningPresentation(state, STRIKE, 143, 30.1);

  assert.equal(due.thunderDue, true);
  assert.equal(repeated.thunderDue, false);
});

test('a thunder tick already passed on first observation is not replayed', () => {
  const state = createLightningPresentationState();
  const late = advanceLightningPresentation(state, STRIKE, 150, 40);
  const later = advanceLightningPresentation(state, STRIKE, 153, 40.05);

  assert.equal(late.thunderDue, false);
  assert.equal(later.thunderDue, false);
});

test('a discontinuity skips historical thunder instead of replaying it', () => {
  const state = createLightningPresentationState();
  advanceLightningPresentation(state, STRIKE, 140, 50);
  const resumed = advanceLightningPresentation(state, STRIKE, 150, 51);

  assert.equal(resumed.visualTick, 150);
  assert.equal(resumed.thunderDue, false);
});

test('source vectors follow the house world-coordinate convention', () => {
  assert.deepEqual(lightningSourceVector('north'), { x: 0, z: 1 });
  assert.deepEqual(lightningSourceVector('east'), { x: 1, z: 0 });
  assert.deepEqual(lightningSourceVector('south'), { x: 0, z: -1 });
  assert.deepEqual(lightningSourceVector('west'), { x: -1, z: 0 });
});
