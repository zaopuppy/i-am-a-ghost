import assert from 'node:assert/strict';
import test from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { createGameServer } from '../../server/createGameServer';
import { GameRoom } from '../../server/GameRoom';
import {
  BUILD_VERSION,
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type MatchFrameEnvelope,
  type RoomActionResponse,
  type RoomState,
  type ServerToClientEvents,
} from '../../src/net/protocol';

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

test('match waits in loading until every connected player has prepared local assets', async (context) => {
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

  assert.deepEqual(await first.emitWithAck('select-role', 'ghost'), { ok: true });
  assert.deepEqual(await second.emitWithAck('select-role', 'child'), { ok: true });

  const loadingPromise = waitForRoomState(first, (state) => state.phase === 'loading');
  assert.deepEqual(await first.emitWithAck('start-match'), { ok: true });
  const loading = await loadingPromise;
  assert.equal(loading.matchId, null);
  assert.deepEqual(loading.players.map((player) => player.assetsReady), [false, false]);

  const oneReadyPromise = waitForRoomState(
    first,
    (state) => state.phase === 'loading' && state.players.some((player) => player.assetsReady),
  );
  assert.deepEqual(await first.emitWithAck('set-assets-ready', true), { ok: true });
  const oneReady = await oneReadyPromise;
  assert.equal(oneReady.players.filter((player) => player.assetsReady).length, 1);

  const firstFramePromise = waitForFrame(first, () => true);
  const secondFramePromise = waitForFrame(second, () => true);
  assert.deepEqual(await second.emitWithAck('set-assets-ready', true), { ok: true });
  const frames = await Promise.all([firstFramePromise, secondFramePromise]);
  assert.ok(frames.every((frame) => frame.matchId.length > 0));
});

test('two clients start an authoritative match and receive directed frames', async (context) => {
  const application = createGameServer();
  const port = await application.listen(0, '127.0.0.1');
  const first = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  const second = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  let reconnected: TestSocket | null = null;
  context.after(async () => {
    first.disconnect();
    second.disconnect();
    reconnected?.disconnect();
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

  assert.deepEqual(await first.emitWithAck('select-role', 'ghost'), { ok: true });
  assert.deepEqual(await second.emitWithAck('select-role', 'child'), { ok: true });

  const firstFramePromise = waitForFrame(first, () => true);
  const secondFramePromise = waitForFrame(second, () => true);
  const started = await first.emitWithAck('start-match');
  assert.deepEqual(started, { ok: true });
  assert.deepEqual(await first.emitWithAck('set-assets-ready', true), { ok: true });
  assert.deepEqual(await second.emitWithAck('set-assets-ready', true), { ok: true });
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

  const childSocket = second;
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

  const expired = await waitForFrame(
    childSocket,
    (envelope) => envelope.frame.tick >= moved.frame.tick + 24,
  );
  const stopped = await waitForFrame(
    childSocket,
    (envelope) => envelope.frame.tick >= expired.frame.tick + 12,
  );
  assert.equal(expired.frame.viewerRole, 'child');
  assert.equal(stopped.frame.viewerRole, 'child');
  const expiredChild = expired.frame.children.find((child) => child.playerId === expired.frame.viewerPlayerId);
  const stoppedChild = stopped.frame.children.find((child) => child.playerId === stopped.frame.viewerPlayerId);
  assert.ok(expiredChild && stoppedChild);
  assert.ok(Math.abs(expiredChild.position.x - stoppedChild.position.x) < 0.001, 'expired input must become neutral');

  const childSession = joined.session;
  const ghostSocket = first;
  const frozenChildFramePromise = waitForFrame(
    ghostSocket,
    (envelope) => envelope.frame.viewerRole === 'ghost'
      && envelope.frame.tick > stopped.frame.tick
      && envelope.frame.children.length === 1,
  );
  childSocket.disconnect();
  const frozenChildFrame = await frozenChildFramePromise;
  assert.equal(frozenChildFrame.frame.viewerRole, 'ghost');
  assert.equal(frozenChildFrame.frame.dolls.length, 3);

  reconnected = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  await waitForConnect(reconnected);
  const restoredFramePromise = waitForFrame(reconnected, (envelope) => envelope.frame.viewerRole === 'child');
  const restored = (await reconnected.emitWithAck('join-room', {
    protocolVersion: PROTOCOL_VERSION,
    buildVersion: BUILD_VERSION,
    nickname: '恢复者',
    roomCode: childSession.roomCode,
    playerId: childSession.playerId,
    rejoinToken: childSession.rejoinToken,
  })) as RoomActionResponse;
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.session.playerId, childSession.playerId);
  const restoredFrame = await restoredFramePromise;
  assert.equal(restoredFrame.frame.viewerRole, 'child');

  const ghostDisconnectedPromise = waitForRoomState(
    reconnected,
    (state) => state.phase === 'playing'
      && state.players.some((player) => player.role === 'ghost' && !player.connected),
  );
  ghostSocket.disconnect();
  const stillPlaying = await ghostDisconnectedPromise;
  assert.ok(stillPlaying.matchId);
  assert.equal(stillPlaying.notice, null);

  const restoredGhost = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  context.after(() => restoredGhost.disconnect());
  await waitForConnect(restoredGhost);
  const restoredGhostFramePromise = waitForFrame(
    restoredGhost,
    (envelope) => envelope.frame.viewerRole === 'ghost',
  );
  const restoredGhostSession = (await restoredGhost.emitWithAck('join-room', {
    protocolVersion: PROTOCOL_VERSION,
    buildVersion: BUILD_VERSION,
    nickname: '恢复的鬼',
    roomCode: created.session.roomCode,
    playerId: created.session.playerId,
    rejoinToken: created.session.rejoinToken,
  })) as RoomActionResponse;
  assert.equal(restoredGhostSession.ok, true);
  const restoredGhostFrame = await restoredGhostFramePromise;
  assert.equal(restoredGhostFrame.frame.viewerRole, 'ghost');
});

test('rooms start correctly with every supported two-to-five player roster', async () => {
  for (let playerCount = 2; playerCount <= 5; playerCount += 1) {
    const application = createGameServer();
    const port = await application.listen(0, '127.0.0.1');
    const sockets = Array.from({ length: playerCount }, () =>
      connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] }));
    try {
      await Promise.all(sockets.map(waitForConnect));
      const created = (await sockets[0].emitWithAck('create-room', {
        protocolVersion: PROTOCOL_VERSION,
        buildVersion: BUILD_VERSION,
        nickname: '房主',
      })) as RoomActionResponse;
      assert.equal(created.ok, true);
      if (!created.ok) continue;
      for (let index = 1; index < sockets.length; index += 1) {
        const joined = (await sockets[index].emitWithAck('join-room', {
          protocolVersion: PROTOCOL_VERSION,
          buildVersion: BUILD_VERSION,
          nickname: `玩家${index + 1}`,
          roomCode: created.session.roomCode,
        })) as RoomActionResponse;
        assert.equal(joined.ok, true);
      }

      assert.deepEqual(await sockets[0].emitWithAck('select-role', 'ghost'), { ok: true });
      for (let index = 1; index < sockets.length; index += 1) {
        assert.deepEqual(await sockets[index].emitWithAck('select-role', 'child'), { ok: true });
      }

      const framePromises = sockets.map((socket) => waitForFrame(socket, () => true));
      assert.deepEqual(await sockets[0].emitWithAck('start-match'), { ok: true });
      for (const socket of sockets) {
        assert.deepEqual(await socket.emitWithAck('set-assets-ready', true), { ok: true });
      }
      const frames = await Promise.all(framePromises);
      assert.equal(frames.filter((frame) => frame.frame.viewerRole === 'ghost').length, 1);
      assert.equal(frames.filter((frame) => frame.frame.viewerRole === 'child').length, playerCount - 1);
      const ghostFrame = frames.find((frame) => frame.frame.viewerRole === 'ghost');
      assert.ok(ghostFrame && ghostFrame.frame.viewerRole === 'ghost');
      assert.equal(ghostFrame.frame.children.length, playerCount - 1);
      assert.equal(ghostFrame.frame.dolls.length, 5 - playerCount);
    } finally {
      for (const socket of sockets) socket.disconnect();
      await application.close();
    }
  }
});

test('the first ghost selection wins and a loading disconnect keeps the locked actor', async (context) => {
  const application = createGameServer();
  const port = await application.listen(0, '127.0.0.1');
  const first = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  const second = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  let restored: TestSocket | null = null;
  context.after(async () => {
    first.disconnect();
    second.disconnect();
    restored?.disconnect();
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

  assert.deepEqual(await first.emitWithAck('select-role', 'spectator' as 'ghost'), {
    ok: false,
    error: { code: 'BAD_REQUEST', message: '阵营选择无效。' },
  });
  assert.deepEqual(await first.emitWithAck('start-match'), {
    ok: false,
    error: {
      code: 'ROLE_SELECTION_REQUIRED',
      message: '所有玩家必须选择阵营，且必须恰好有一名鬼。',
    },
  });
  const ghostChosen = waitForRoomState(
    first,
    (state) => state.players.filter((player) => player.selectedRole === 'ghost').length === 1,
  );
  const claims = await Promise.all([
    first.emitWithAck('select-role', 'ghost'),
    second.emitWithAck('select-role', 'ghost'),
  ]);
  assert.equal(claims.filter((result) => result.ok).length, 1);
  assert.equal(claims.filter(
    (result) => !result.ok && result.error.code === 'GHOST_TAKEN',
  ).length, 1);
  const selected = await ghostChosen;
  const ghostPlayer = selected.players.find((player) => player.selectedRole === 'ghost');
  assert.ok(ghostPlayer);
  const ghostSocket = ghostPlayer.playerId === created.session.playerId ? first : second;
  const childSocket = ghostSocket === first ? second : first;
  const childSession = ghostSocket === first ? joined.session : created.session;
  assert.equal(
    selected.players.find((player) => player.playerId === childSession.playerId)?.selectedRole,
    null,
  );
  assert.deepEqual((await first.emitWithAck('start-match') as { error?: { code: string } }).error?.code,
    'ROLE_SELECTION_REQUIRED');
  assert.deepEqual(await childSocket.emitWithAck('select-role', 'child'), { ok: true });
  assert.deepEqual(await first.emitWithAck('start-match'), { ok: true });
  assert.deepEqual(await ghostSocket.emitWithAck('set-assets-ready', true), { ok: true });

  const playingFramePromise = waitForFrame(
    ghostSocket,
    (envelope) => envelope.frame.viewerRole === 'ghost' && envelope.frame.children.length === 1,
  );
  childSocket.disconnect();
  const playingFrame = await playingFramePromise;
  assert.equal(playingFrame.frame.dolls.length, 3);

  restored = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  await waitForConnect(restored);
  const restoredFramePromise = waitForFrame(
    restored,
    (envelope) => envelope.frame.viewerRole === 'child',
  );
  const rejoined = (await restored.emitWithAck('join-room', {
    protocolVersion: PROTOCOL_VERSION,
    buildVersion: BUILD_VERSION,
    nickname: '恢复者',
    roomCode: childSession.roomCode,
    playerId: childSession.playerId,
    rejoinToken: childSession.rejoinToken,
  })) as RoomActionResponse;
  assert.equal(rejoined.ok, true);
  assert.equal((await restoredFramePromise).frame.viewerRole, 'child');
});

test('ended-round role changes clear readiness before all connected players can load', async (context) => {
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

  const room = (application.roomManager as unknown as { rooms: Map<string, GameRoom> })
    .rooms.get(created.session.roomCode);
  assert.ok(room);
  (room as unknown as { phase: RoomState['phase'] }).phase = 'ended';

  assert.equal((await first.emitWithAck('set-ready', true) as { error?: { code: string } }).error?.code,
    'ROLE_SELECTION_REQUIRED');
  assert.deepEqual(await first.emitWithAck('select-role', 'ghost'), { ok: true });
  assert.deepEqual(await second.emitWithAck('select-role', 'child'), { ok: true });
  assert.deepEqual(await first.emitWithAck('set-ready', true), { ok: true });

  const changedSelectionPromise = waitForRoomState(
    second,
    (state) => state.players.some((player) => (
      player.playerId === created.session.playerId
      && player.selectedRole === 'child'
      && !player.ready
    )),
  );
  assert.deepEqual(await first.emitWithAck('select-role', 'child'), { ok: true });
  await changedSelectionPromise;
  assert.deepEqual(await second.emitWithAck('select-role', 'ghost'), { ok: true });
  assert.deepEqual(await first.emitWithAck('set-ready', true), { ok: true });
  const loadingPromise = waitForRoomState(second, (state) => state.phase === 'loading');
  assert.deepEqual(await second.emitWithAck('set-ready', true), { ok: true });
  const loading = await loadingPromise;
  assert.equal(loading.players.find((player) => player.playerId === created.session.playerId)?.role, 'child');
  assert.equal(loading.players.find((player) => player.playerId === joined.session.playerId)?.role, 'ghost');
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

function waitForRoomState(
  socket: TestSocket,
  predicate: (state: RoomState) => boolean,
): Promise<RoomState> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('room-state', listener);
      reject(new Error('room state timed out'));
    }, 3_000);
    const listener = (state: RoomState): void => {
      if (!predicate(state)) return;
      clearTimeout(timeout);
      socket.off('room-state', listener);
      resolve(state);
    };
    socket.on('room-state', listener);
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
