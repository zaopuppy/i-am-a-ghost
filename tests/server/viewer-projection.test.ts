import assert from 'node:assert/strict';
import test from 'node:test';
import { MATCH_RULES, MatchEngine, type MatchMap } from '../../src/game/MatchEngine';
import { projectViewerFrame } from '../../server/ViewerProjection';

const TEST_MAP: MatchMap = {
  id: 'projection-test',
  bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
  walls: [],
  ghostSpawn: { x: 1, z: 0 },
  childSpawns: [
    { x: 0, z: 0 },
    { x: -4, z: 0 },
    { x: 0, z: 4 },
    { x: 0, z: -4 },
  ],
  batterySpawns: [{ x: 5, z: 5 }],
};

test('child frames omit the hidden ghost and every private checkpoint field', () => {
  const engine = new MatchEngine({
    seed: 7,
    map: TEST_MAP,
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  const frame = projectViewerFrame(engine.checkpoint(), 'child');
  assert.equal(frame.viewerRole, 'child');
  assert.equal(frame.ghost, undefined);

  const serialized = JSON.stringify(frame);
  assert.doesNotMatch(serialized, /randomState/);
  assert.doesNotMatch(serialized, /ghostAction/);
  assert.doesNotMatch(serialized, /phaseTicksRemaining/);
  assert.doesNotMatch(serialized, /"x":1,"z":0/);
});

test('hidden ghost coordinates stay absent with every supported real-child count', () => {
  for (let childCount = 1; childCount <= 4; childCount += 1) {
    const childPlayerIds = Array.from({ length: childCount }, (_, index) => `child-${index + 1}`);
    const engine = new MatchEngine({
      seed: 70 + childCount,
      map: TEST_MAP,
      ghostPlayerId: 'ghost',
      childPlayerIds,
    });
    const checkpoint = engine.checkpoint();
    const ghost = checkpoint.players.find((player) => player.role === 'ghost');
    assert.ok(ghost);

    for (const childPlayerId of childPlayerIds) {
      const serialized = JSON.stringify(projectViewerFrame(checkpoint, childPlayerId));
      assert.doesNotMatch(serialized, new RegExp(`\\"x\\":${ghost.position.x},\\"z\\":${ghost.position.z}`));
      assert.doesNotMatch(serialized, /randomState|ghostAction|phaseTicksRemaining/);
    }
  }
});

test('a beam reveals the ghost to children while the ghost always receives every actor', () => {
  const engine = new MatchEngine({
    seed: 11,
    map: TEST_MAP,
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });
  engine.advance([
    { playerId: 'child', move: { x: 0, z: 0 }, facingRadians: 0, action: true },
  ]);

  const childFrame = projectViewerFrame(engine.checkpoint(), 'child');
  assert.equal(childFrame.viewerRole, 'child');
  assert.deepEqual(childFrame.ghost?.position, { x: 1, z: 0 });

  const ghostFrame = projectViewerFrame(engine.checkpoint(), 'ghost');
  assert.equal(ghostFrame.viewerRole, 'ghost');
  assert.equal(ghostFrame.children.length, 1);
  assert.equal(ghostFrame.dolls.length, 3);
  assert.deepEqual(ghostFrame.ghost.position, { x: 1, z: 0 });
});

test('one successful beam reveals the ghost in every child-directed frame', () => {
  const engine = new MatchEngine({
    seed: 13,
    map: TEST_MAP,
    ghostPlayerId: 'ghost',
    childPlayerIds: ['near-child', 'far-child'],
  });
  engine.advance([
    { playerId: 'near-child', move: { x: 0, z: 0 }, facingRadians: 0, action: true },
  ]);

  for (const playerId of ['near-child', 'far-child']) {
    const frame = projectViewerFrame(engine.checkpoint(), playerId);
    assert.equal(frame.viewerRole, 'child');
    assert.deepEqual(frame.ghost?.position, { x: 1, z: 0 });
  }
});

test('capture presentation reveals the ghost only to the captured child', () => {
  const engine = new MatchEngine({
    seed: 15,
    map: {
      ...TEST_MAP,
      ghostSpawn: { x: 0, z: 0 },
      childSpawns: [
        { x: 0.95, z: 0 },
        { x: -4, z: 0 },
        TEST_MAP.childSpawns[2],
        TEST_MAP.childSpawns[3],
      ],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['captured-child', 'other-child'],
  });
  engine.advance();

  const capturedFrame = projectViewerFrame(engine.checkpoint(), 'captured-child');
  assert.equal(capturedFrame.viewerRole, 'child');
  assert.equal(capturedFrame.capture?.childPlayerId, 'captured-child');
  assert.equal(capturedFrame.capture?.durationTicks, MATCH_RULES.captureAnimationTicks);
  assert.deepEqual(capturedFrame.ghost?.position, { x: 0, z: 0 });

  const otherFrame = projectViewerFrame(engine.checkpoint(), 'other-child');
  assert.equal(otherFrame.viewerRole, 'child');
  assert.equal(otherFrame.capture?.childPlayerId, 'captured-child');
  assert.equal(otherFrame.ghost, undefined);
  assert.doesNotMatch(JSON.stringify(otherFrame), /phaseTicksRemaining|capturedChildPlayerId/);
});

test('a disconnected child is projected as a non-player sensing doll', () => {
  const engine = new MatchEngine({
    seed: 17,
    map: TEST_MAP,
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });
  engine.setPlayerActive('child', false);
  const ghostFrame = projectViewerFrame(engine.checkpoint(), 'ghost');
  assert.equal(ghostFrame.viewerRole, 'ghost');
  assert.equal(ghostFrame.children.length, 0);
  assert.equal(ghostFrame.dolls.length, 4);
  assert.ok(ghostFrame.dolls.some((doll) => doll.dollId === 'disconnected-child'));
});
