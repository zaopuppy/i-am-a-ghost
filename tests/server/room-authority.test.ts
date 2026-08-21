import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_GAMEPLAY_TUNING,
  type MatchCheckpoint,
} from '../../src/game/MatchEngine';
import {
  activeFlashlightPlayerIds,
  buildAuthorityCommands,
  type AuthorityPlayerInput,
} from '../../src/net/RoomAuthority';

const NOW_MS = 1_000;

test('shared authority drops stale movement and action input', () => {
  const players = [playerInput(700, true)];
  assert.deepEqual(buildAuthorityCommands(players, NOW_MS), [{
    playerId: 'child',
    move: { x: 0, z: 0 },
    facingRadians: 0.75,
    action: false,
  }]);
});

test('shared authority projects a flashlight only for fresh input with energy', () => {
  const players = [playerInput(995, true)];
  const emptyBattery = checkpoint(0);
  assert.deepEqual(
    [...activeFlashlightPlayerIds(emptyBattery, players, DEFAULT_GAMEPLAY_TUNING, NOW_MS)],
    [],
  );
  assert.deepEqual(
    [...activeFlashlightPlayerIds(checkpoint(1), players, DEFAULT_GAMEPLAY_TUNING, NOW_MS)],
    ['child'],
  );
  assert.deepEqual(
    [...activeFlashlightPlayerIds(
      emptyBattery,
      players,
      { ...DEFAULT_GAMEPLAY_TUNING, infiniteFlashlightEnergy: true },
      NOW_MS,
    )],
    ['child'],
  );
});

function playerInput(lastInputAtMs: number, action: boolean): AuthorityPlayerInput {
  return {
    playerId: 'child',
    connected: true,
    role: 'child',
    latestInput: {
      matchId: 'match',
      seq: 1,
      clientTick: 1,
      moveX: 1,
      moveZ: 0,
      facingRadians: 0.75,
      action,
    },
    lastInputAtMs,
  };
}

function checkpoint(battery: number): MatchCheckpoint {
  return {
    tick: 0,
    phase: 'playing',
    winner: null,
    remainingTicks: 60,
    captureCount: 0,
    phaseTicksRemaining: 0,
    capturedChildPlayerId: null,
    ghostHealth: 100,
    ghostRevealed: false,
    ghostBurnTicksRemaining: 0,
    randomState: 1,
    players: [{
      id: 'child',
      role: 'child',
      slot: 0,
      position: { x: 0, z: 0 },
      facingRadians: 0,
      battery,
      headlamp: 'off',
      active: true,
    }],
    dolls: [],
    batteries: [],
    battery: null,
  };
}
