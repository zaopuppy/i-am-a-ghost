import assert from 'node:assert/strict';
import test from 'node:test';
import { runBotMatch } from '../../src/testing/BalanceSimulation';

test('deterministic bot matches exercise one to four real child slots without softlocks', () => {
  for (let childCount = 1; childCount <= 4; childCount += 1) {
    const left = runBotMatch({ childCount, seed: 6000 + childCount });
    const right = runBotMatch({ childCount, seed: 6000 + childCount });

    assert.deepEqual(left, right);
    assert.ok(left.winner === 'children' || left.winner === 'ghost');
    assert.ok(left.effectiveDurationSeconds > 0 && left.effectiveDurationSeconds <= 300);
    assert.ok(left.wallDurationSeconds <= 311);
    assert.ok(left.minimumHumanDistance >= 0.899);
    assert.equal(left.permanentOverlap, false);
    assert.equal(left.wallPenetrations, 0);
    assert.equal(left.softlockWindows, 0);
    assert.equal(left.childCount, childCount);
  }
});

test('bot metrics include the first-contact, resource, collision, and warning signals', () => {
  const result = runBotMatch({ childCount: 4, seed: 7004 });

  assert.ok(result.firstBeamHitSeconds === null || result.firstBeamHitSeconds >= 0);
  assert.ok(result.firstCaptureSeconds === null || result.firstCaptureSeconds >= 0);
  assert.ok(result.thirdCaptureSeconds === null || result.thirdCaptureSeconds >= 0);
  assert.ok(result.effectiveBeamSeconds >= 0);
  assert.ok(result.batterySpawns >= result.batteryCollections);
  assert.ok(result.averageBatteryPickupDelaySeconds === null || result.averageBatteryPickupDelaySeconds >= 0);
  assert.ok(result.averageBatteryDepletions >= 0);
  assert.ok(result.doorwayBlockEpisodes >= 0);
  assert.ok(result.warningBandSeconds.off >= 0);
  assert.ok(result.warningBandSeconds.slow >= 0);
  assert.ok(result.warningBandSeconds.fast >= 0);
  assert.ok(result.warningBandSeconds.solid >= 0);
});
