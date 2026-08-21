import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILD_VERSION,
  PROTOCOL_VERSION,
  parseHarmonyClientMessage,
} from '../../src/net/protocol';

test('Harmony room protocol rejects legal JSON with invalid fields', () => {
  assert.equal(parseHarmonyClientMessage({
    type: 'join-room',
    requestId: 'join-1',
    protocolVersion: PROTOCOL_VERSION,
    buildVersion: BUILD_VERSION,
    roomCode: 'GHOST7',
    nickname: null,
  }), null);
  assert.equal(parseHarmonyClientMessage({ type: 'set-ready', requestId: 'ready-1', ready: 'yes' }), null);
  assert.equal(parseHarmonyClientMessage({ type: 'unknown', requestId: 'unknown-1' }), null);
});

test('Harmony room protocol returns a validated request copy', () => {
  assert.deepEqual(parseHarmonyClientMessage({
    type: 'join-room',
    requestId: 'join-1',
    protocolVersion: PROTOCOL_VERSION,
    buildVersion: BUILD_VERSION,
    roomCode: 'GHOST7',
    nickname: '访客',
    ignored: 'field',
  }), {
    type: 'join-room',
    requestId: 'join-1',
    protocolVersion: PROTOCOL_VERSION,
    buildVersion: BUILD_VERSION,
    roomCode: 'GHOST7',
    nickname: '访客',
  });
});
