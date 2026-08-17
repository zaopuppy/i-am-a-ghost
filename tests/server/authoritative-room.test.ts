import assert from 'node:assert/strict';
import test from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { createGameServer } from '../../server/createGameServer';
import {
  BUILD_VERSION,
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type MatchFrameEnvelope,
  type RoomActionResponse,
  type ServerToClientEvents,
} from '../../src/net/protocol';

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

test('two clients start an authoritative match and receive directed frames', async (context) => {
  const application = createGameServer();
  const port = await application.listen(0, '127.0.0.1');
  const first = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  const second = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  context.after(async () => {
    first.disconnect();
    second.disconnect();
    await application.close();
  });
  await Promise.all([waitForConnect(first), waitForConnect(second)]);

  const created = (await first.emitWithAck('create-room', {
    protocolVersion: PROTOCOL_VERSION,
    buildVersion: BUILD_VERSION,
    nickname: '甲',
  })) as RoomActionResponse;
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const joined = (await second.emitWithAck('join-room', {
    protocolVersion: PROTOCOL_VERSION,
    buildVersion: BUILD_VERSION,
    nickname: '乙',
    roomCode: created.session.roomCode,
  })) as RoomActionResponse;
  assert.equal(joined.ok, true);
  if (!joined.ok) return;

  const firstFramePromise = waitForFrame(first, () => true);
  const secondFramePromise = waitForFrame(second, () => true);
  const started = await first.emitWithAck('start-match');
  assert.deepEqual(started, { ok: true });
  const frames = await Promise.all([firstFramePromise, secondFramePromise]);
  const ghostFrame = frames.find((envelope) => envelope.frame.viewerRole === 'ghost');
  const childFrame = frames.find((envelope) => envelope.frame.viewerRole === 'child');
  assert.ok(ghostFrame);
  assert.ok(childFrame);
  assert.equal(ghostFrame.frame.viewerRole, 'ghost');
  assert.equal(ghostFrame.frame.children.length, 1);
  assert.equal(ghostFrame.frame.dolls.length, 3);
  assert.equal(childFrame.frame.viewerRole, 'child');
  assert.equal(childFrame.frame.ghost, undefined);
  assert.doesNotMatch(JSON.stringify(childFrame), /randomState|ghostAction|phaseTicksRemaining/);

  const childSocket = childFrame.frame.viewerPlayerId === created.session.playerId ? first : second;
  const initialChild = childFrame.frame.children.find(
    (child) => child.playerId === childFrame.frame.viewerPlayerId,
  );
  assert.ok(initialChild);
  childSocket.emit('input-frame', {
    matchId: childFrame.matchId,
    seq: 2,
    clientTick: 2,
    moveX: 1,
    moveZ: 0,
    facingRadians: 0,
    action: false,
  });
  childSocket.emit('input-frame', {
    matchId: childFrame.matchId,
    seq: 1,
    clientTick: 1,
    moveX: -1,
    moveZ: 0,
    facingRadians: Math.PI,
    action: false,
  });
  const moved = await waitForFrame(
    childSocket,
    (envelope) => envelope.ackSeq === 2 && envelope.frame.tick >= childFrame.frame.tick + 6,
  );
  assert.equal(moved.frame.viewerRole, 'child');
  const movedChild = moved.frame.children.find((child) => child.playerId === moved.frame.viewerPlayerId);
  assert.ok(movedChild);
  assert.ok(movedChild.position.x > initialChild.position.x, 'stale input must not reverse movement');
});

function waitForConnect(socket: TestSocket): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('socket connection timed out')), 2_000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function waitForFrame(
  socket: TestSocket,
  predicate: (envelope: MatchFrameEnvelope) => boolean,
): Promise<MatchFrameEnvelope> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('match-frame', listener);
      reject(new Error('match frame timed out'));
    }, 3_000);
    const listener = (envelope: MatchFrameEnvelope): void => {
      if (!predicate(envelope)) return;
      clearTimeout(timeout);
      socket.off('match-frame', listener);
      resolve(envelope);
    };
    socket.on('match-frame', listener);
  });
}
