import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DETERMINISTIC_STATE_NAMES,
  createDeterministicViewerFrame,
} from '../../src/testing/DeterministicStates';
import {
  advanceLightningPresentation,
  createLightningPresentationState,
} from '../../src/game/LightningPresentation';

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

test('lightning test states freeze each direction at the main-flash peak', () => {
  const expected = {
    'lightning-north-main': { direction: 'north', position: { x: 0, z: 6.7 } },
    'lightning-east-main': { direction: 'east', position: { x: 10.45, z: 0 } },
    'lightning-south-main': { direction: 'south', position: { x: 0, z: -6.7 } },
    'lightning-west-main': { direction: 'west', position: { x: -10.45, z: 0 } },
  } as const;

  for (const [state, fixture] of Object.entries(expected)) {
    const frame = createDeterministicViewerFrame(state as keyof typeof expected, 71);
    assert.equal(frame.lightning?.direction, fixture.direction);
    const mainPulse = frame.lightning?.pulses.find((pulse) => pulse.kind === 'main');
    assert.ok(mainPulse);
    const progress = (frame.tick - mainPulse.startTick) / mainPulse.durationTicks;
    assert.ok(progress >= 0.12 && progress <= 0.62);
    const presentation = advanceLightningPresentation(
      createLightningPresentationState(),
      frame.lightning,
      frame.tick,
      0,
    );
    assert.equal(presentation.pulseKind, 'main');
    assert.ok(presentation.intensity >= 0.95);
    assert.equal(frame.viewerRole, 'child');
    if (frame.viewerRole !== 'child') throw new Error('Expected child frame.');
    assert.deepEqual(frame.ghost?.position, fixture.position);
  }
});

test('combined performance state keeps flashlight hit, burn, and lightning active together', () => {
  const frame = createDeterministicViewerFrame('flashlight-lightning-hit', 71);
  assert.equal(frame.viewerRole, 'child');
  if (frame.viewerRole !== 'child') throw new Error('Expected child frame.');
  assert.equal(frame.children.find((child) => child.playerId === 'child-1')?.flashlightOn, true);
  assert.equal(frame.ghost?.burning, true);
  assert.equal(frame.lightning?.direction, 'north');
  const mainPulse = frame.lightning?.pulses.find((pulse) => pulse.kind === 'main');
  assert.ok(mainPulse);
  assert.ok(frame.tick >= mainPulse.startTick);
  assert.ok(frame.tick < mainPulse.startTick + mainPulse.durationTicks);
});
