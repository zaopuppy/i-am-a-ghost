import assert from 'node:assert/strict';
import test from 'node:test';
import { FramePresenter, movePredictedPosition } from '../../src/net/FramePresenter';
import type { ChildViewerFrame } from '../../src/game/ViewerFrame';

test('presentation predicts only the local actor and interpolates a remote actor', () => {
  const presenter = new FramePresenter();
  presenter.ingest('match', childFrame(0, 0, 10));
  presenter.ingest('match', childFrame(3, 0, 12));
  presenter.ingest('match', childFrame(6, 0, 14));
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

test('remote presentation stays continuous when 20 Hz frames arrive with jitter', () => {
  const presenter = new FramePresenter();
  const packets = Array.from({ length: 41 }, (_, index) => ({
    arrivalMs: index * 50 + (index % 2 === 0 ? 40 : 80),
    tick: index * 3,
    remoteX: index * 0.15,
  }));
  let packetIndex = 0;
  const positions: number[] = [];

  for (let elapsedMs = 0; elapsedMs <= 1_600; elapsedMs += 1_000 / 60) {
    while (packetIndex < packets.length && packets[packetIndex].arrivalMs <= elapsedMs + 0.001) {
      const packet = packets[packetIndex];
      presenter.ingest('match', childFrame(packet.tick, 0, packet.remoteX));
      packetIndex += 1;
    }
    const frame = presenter.present(1 / 60, { x: 0, z: 0 });
    const remote = frame?.children.find((child) => child.playerId === 'remote');
    if (remote && elapsedMs >= 300 && elapsedMs <= 1_400) positions.push(remote.position.x);
  }

  const steps = positions.slice(1).map((position, index) => position - positions[index]);
  assert.equal(
    steps.filter((step) => Math.abs(step) < 1e-6).length,
    0,
    'packet jitter must not produce frozen remote render frames',
  );
  assert.ok(
    Math.max(...steps) < 0.075,
    'packet jitter must not produce catch-up jumps larger than one-and-a-half render steps',
  );
});

test('normal authority latency does not pull local prediction backwards', () => {
  const presenter = new FramePresenter();
  presenter.ingest('match', childFrame(0, 0, 10));
  const packets = Array.from({ length: 20 }, (_, index) => {
    const tick = (index + 1) * 3;
    return {
      arrivalMs: (tick / 60) * 1_000 + 80,
      tick,
      ownX: (tick / 60) * 3,
    };
  });
  let packetIndex = 0;
  const positions: number[] = [];

  for (let elapsedMs = 1_000 / 60; elapsedMs <= 1_100; elapsedMs += 1_000 / 60) {
    while (packetIndex < packets.length && packets[packetIndex].arrivalMs <= elapsedMs + 0.001) {
      const packet = packets[packetIndex];
      presenter.ingest('match', childFrame(packet.tick, packet.ownX, 10));
      packetIndex += 1;
    }
    const frame = presenter.present(
      1 / 60,
      { x: 1, z: 0 },
      { childMoveSpeed: 3, ghostMoveSpeed: 3 },
    );
    if (frame) positions.push(frame.children[0].position.x);
  }

  const steps = positions.slice(1).map((position, index) => position - positions[index]);
  assert.equal(
    steps.filter((step) => step < -0.001).length,
    0,
    'normal snapshot latency must not move the local actor backwards',
  );
  assert.equal(
    presenter.stats().corrections,
    0,
    'normal latency lead must not be mistaken for an authority divergence',
  );
});

test('snapshot playback catches up after a temporary render slowdown', () => {
  const presenter = new FramePresenter();
  const packets = Array.from({ length: 61 }, (_, index) => ({
    arrivalMs: index * 50,
    tick: index * 3,
    remoteX: index * 0.15,
  }));
  let packetIndex = 0;

  for (let elapsedMs = 0; elapsedMs <= 2_500;) {
    while (packetIndex < packets.length && packets[packetIndex].arrivalMs <= elapsedMs + 0.001) {
      const packet = packets[packetIndex];
      presenter.ingest('match', childFrame(packet.tick, 0, packet.remoteX));
      packetIndex += 1;
    }
    const renderingIsSlow = elapsedMs < 500;
    presenter.present(renderingIsSlow ? 0.05 : 1 / 60, { x: 0, z: 0 });
    elapsedMs += renderingIsSlow ? 100 : 1_000 / 60;
  }

  assert.ok(
    presenter.stats().bufferLeadMs <= 125,
    'temporary rendering stalls must not leave remote presentation permanently far behind',
  );
});

function childFrame(tick: number, ownX: number, remoteX: number): ChildViewerFrame {
  return {
    tick,
    phase: 'playing',
    winner: null,
    remainingTicks: 18_000 - tick,
    captureCount: 0,
    ghostHealth: 100,
    capture: null,
    viewerRole: 'child',
    viewerPlayerId: 'own',
    ownBattery: 1,
    batteries: [],
    children: [
      { playerId: 'own', slot: 0, position: { x: ownX, z: -5 }, facingRadians: 0, headlamp: 'off', flashlightOn: false, batteryCharge: 1 },
      { playerId: 'remote', slot: 1, position: { x: remoteX, z: 8 }, facingRadians: 0, headlamp: 'off', flashlightOn: false, batteryCharge: 1 },
    ],
    dolls: [],
  };
}
