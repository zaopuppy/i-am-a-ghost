import assert from 'node:assert/strict';
import test from 'node:test';
import { FramePresenter, movePredictedPosition } from '../../src/net/FramePresenter';
import type { ChildViewerFrame } from '../../src/game/ViewerFrame';

test('presentation predicts only the local actor and interpolates a remote actor', () => {
  const presenter = new FramePresenter();
  presenter.ingest('match', childFrame(0, 0, 10));
  presenter.ingest('match', childFrame(3, 0, 12));
  const presented = presenter.present(0.025, { x: 1, z: 0 });
  assert.equal(presented.viewerRole, 'child');
  const own = presented.children.find((child) => child.playerId === 'own');
  const remote = presented.children.find((child) => child.playerId === 'remote');
  assert.ok(own && remote);
  assert.ok(own.position.x > 0, 'local actor should be predicted immediately');
  assert.ok(remote.position.x > 10 && remote.position.x < 12, 'remote actor should be interpolated');
});

test('prediction respects static house walls and records hard corrections', () => {
  const blocked = movePredictedPosition({ x: -5.56, z: -8 }, { x: 1, z: 0 }, 1);
  assert.ok(blocked.x <= -5.55);

  const presenter = new FramePresenter();
  presenter.ingest('match', childFrame(0, 0, 10));
  presenter.present(0.1, { x: 1, z: 0 });
  presenter.ingest('match', childFrame(3, 5, 10));
  assert.equal(presenter.stats().hardSnaps, 1);
});

function childFrame(tick: number, ownX: number, remoteX: number): ChildViewerFrame {
  return {
    tick,
    phase: 'playing',
    winner: null,
    remainingTicks: 18_000 - tick,
    captureCount: 0,
    ghostHealth: 100,
    viewerRole: 'child',
    viewerPlayerId: 'own',
    ownBattery: 1,
    children: [
      { playerId: 'own', slot: 0, position: { x: ownX, z: -8 }, facingRadians: 0, headlamp: 'off', flashlightOn: false },
      { playerId: 'remote', slot: 1, position: { x: remoteX, z: 8 }, facingRadians: 0, headlamp: 'off', flashlightOn: false },
    ],
    dolls: [],
  };
}
