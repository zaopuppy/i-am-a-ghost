import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_HOUSE_MAP } from '../../src/game/defaultHouse';
import {
  MATCH_RULES,
  MatchEngine,
  isPositionLitByLightning,
  type MatchAdvanceResult,
  type MatchMap,
} from '../../src/game/MatchEngine';

const OPEN_MAP: MatchMap = {
  id: 'open-test-house',
  bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
  walls: [],
  ghostSpawn: { x: -10, z: -10 },
  childSpawns: [
    { x: 0, z: 0 },
    { x: 8, z: 8 },
    { x: -8, z: 8 },
    { x: 8, z: -8 },
  ],
  batterySpawns: [{ x: 4, z: 4 }],
};

function assertApproximately(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be approximately ${expected}`);
}

test('ghost starts with the reduced 50 health balance value', () => {
  const engine = new MatchEngine({
    seed: 7,
    map: OPEN_MAP,
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  assert.equal(MATCH_RULES.ghostMaxHealth, 50);
  assert.equal(engine.checkpoint().ghostHealth, 50);
});

test('lightning schedules independently after 10 to 20 seconds of playing time', () => {
  const engine = new MatchEngine({
    seed: 101,
    map: OPEN_MAP,
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });
  const initial = engine.checkpoint();
  assert.ok(initial.nextLightningPlayingTick >= MATCH_RULES.lightningMinimumIntervalTicks);
  assert.ok(initial.nextLightningPlayingTick <= MATCH_RULES.lightningMaximumIntervalTicks);
  const gameplayRandomState = initial.randomState;

  const result = engine.advance([], initial.nextLightningPlayingTick);
  const event = result.events.find((candidate) => candidate.type === 'lightning-started');
  assert.ok(event?.type === 'lightning-started');
  assert.deepEqual(result.checkpoint.lightning, event.lightning);
  assert.equal(result.checkpoint.lightningSerial, event.lightning.id);
  assert.equal(result.checkpoint.randomState, gameplayRandomState);
  assert.ok(['north', 'east', 'south', 'west'].includes(event.lightning.direction));
  assert.ok(event.lightning.pulses.length === 3 || event.lightning.pulses.length === 4);
  assert.equal(event.lightning.pulses.at(-1)?.kind, 'main');
  assert.ok(result.checkpoint.nextLightningPlayingTick - result.checkpoint.lightningPlayingTick
    >= MATCH_RULES.lightningMinimumIntervalTicks);
  assert.ok(result.checkpoint.nextLightningPlayingTick - result.checkpoint.lightningPlayingTick
    <= MATCH_RULES.lightningMaximumIntervalTicks);
  for (const pulse of event.lightning.pulses) {
    const minimum = pulse.kind === 'main'
      ? MATCH_RULES.lightningMainMinimumTicks
      : MATCH_RULES.lightningPreflashMinimumTicks;
    const maximum = pulse.kind === 'main'
      ? MATCH_RULES.lightningMainMaximumTicks
      : MATCH_RULES.lightningPreflashMaximumTicks;
    assert.ok(pulse.durationTicks >= minimum && pulse.durationTicks <= maximum);
  }
  for (let index = 1; index < event.lightning.pulses.length; index += 1) {
    const previous = event.lightning.pulses[index - 1];
    const gap = event.lightning.pulses[index].startTick
      - previous.startTick
      - previous.durationTicks;
    assert.ok(gap >= MATCH_RULES.lightningGapMinimumTicks);
    assert.ok(gap <= MATCH_RULES.lightningGapMaximumTicks);
  }
  const main = event.lightning.pulses.at(-1);
  assert.ok(main);
  const sequenceDuration = main.startTick + main.durationTicks - event.lightning.startTick;
  const minimumSequenceDuration = MATCH_RULES.lightningPreflashMinimumTicks * 2
    + MATCH_RULES.lightningGapMinimumTicks * 2
    + MATCH_RULES.lightningMainMinimumTicks;
  const maximumSequenceDuration = MATCH_RULES.lightningPreflashMaximumTicks * 3
    + MATCH_RULES.lightningGapMaximumTicks * 3
    + MATCH_RULES.lightningMainMaximumTicks;
  assert.ok(sequenceDuration >= minimumSequenceDuration);
  assert.ok(sequenceDuration <= maximumSequenceDuration);
  const thunderDelay = event.lightning.thunderTick - main.startTick - main.durationTicks;
  assert.ok(thunderDelay >= MATCH_RULES.lightningThunderMinimumDelayTicks);
  assert.ok(thunderDelay <= MATCH_RULES.lightningThunderMaximumDelayTicks);
});

test('lightning direction draws are independent and may repeat consecutively', () => {
  const engine = new MatchEngine({
    seed: 1,
    map: OPEN_MAP,
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });
  let checkpoint = engine.checkpoint();
  engine.advance([], checkpoint.nextLightningPlayingTick);
  const firstDirection = engine.checkpoint().lightning?.direction;
  checkpoint = engine.checkpoint();
  engine.advance([], checkpoint.nextLightningPlayingTick - checkpoint.lightningPlayingTick);
  const secondDirection = engine.checkpoint().lightning?.direction;
  assert.equal(firstDirection, 'west');
  assert.equal(secondDirection, firstDirection);
});

test('lightning cooldown pauses throughout capture animation and protection', () => {
  const engine = new MatchEngine({
    seed: 103,
    map: {
      ...OPEN_MAP,
      ghostSpawn: { x: 0, z: 0 },
      childSpawns: [
        { x: 0.95, z: 0 },
        OPEN_MAP.childSpawns[1],
        OPEN_MAP.childSpawns[2],
        OPEN_MAP.childSpawns[3],
      ],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });
  engine.advance([], MATCH_RULES.captureContactTicks);
  const captured = engine.checkpoint();
  assert.equal(captured.phase, 'capture-animation');
  assert.equal(captured.lightningPlayingTick, MATCH_RULES.captureContactTicks);

  engine.advance([], MATCH_RULES.captureAnimationTicks + MATCH_RULES.protectionTicks);
  const resumed = engine.checkpoint();
  assert.equal(resumed.phase, 'playing');
  assert.equal(resumed.lightningPlayingTick, captured.lightningPlayingTick);
  assert.equal(resumed.nextLightningPlayingTick, captured.nextLightningPlayingTick);
});

test('lightning ignores boundary walls but needs two of three samples through interior walls', () => {
  const boundaryOnly: MatchMap = {
    ...OPEN_MAP,
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    walls: [
      { id: 'boundary:north', minX: -10.2, maxX: 10.2, minZ: 9.8, maxZ: 10.2 },
    ],
  };
  assert.equal(isPositionLitByLightning(boundaryOnly, { x: 0, z: 0 }, 'north'), true);

  const mostlyBlocked: MatchMap = {
    ...boundaryOnly,
    walls: [
      ...boundaryOnly.walls,
      { id: 'inner-left', minX: -10, maxX: 0.1, minZ: 3, maxZ: 3.2 },
    ],
  };
  assert.equal(isPositionLitByLightning(mostlyBlocked, { x: 0, z: 0 }, 'north'), false);

  const doorway: MatchMap = {
    ...boundaryOnly,
    walls: [
      ...boundaryOnly.walls,
      { id: 'inner-left', minX: -10, maxX: -0.3, minZ: 3, maxZ: 3.2 },
      { id: 'inner-right', minX: 0.6, maxX: 10, minZ: 3, maxZ: 3.2 },
    ],
  };
  assert.equal(isPositionLitByLightning(doorway, { x: 0, z: 0 }, 'north'), true);
});

test('lightning reveals a frozen ghost position without burn, damage, or slowdown', () => {
  const engine = new MatchEngine({
    seed: 107,
    map: OPEN_MAP,
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });
  const waitTicks = engine.checkpoint().nextLightningPlayingTick;
  engine.advance([], waitTicks);
  const strike = engine.checkpoint().lightning;
  assert.ok(strike);

  const moving = engine.advance([
    { playerId: 'ghost', move: { x: 1, z: 0 }, facingRadians: 0, action: false },
  ]).checkpoint;
  const ghostWhileLit = moving.players.find((player) => player.role === 'ghost');
  assert.ok(ghostWhileLit && moving.lightningReveal);
  assertApproximately(ghostWhileLit.position.x, -10 + MATCH_RULES.ghostMoveSpeed / MATCH_RULES.tickRate);
  assert.equal(moving.ghostHealth, MATCH_RULES.ghostMaxHealth);
  assert.equal(moving.ghostBurnTicksRemaining, 0);

  const firstPulse = strike.pulses[0];
  const ticksUntilGap = firstPulse.startTick + firstPulse.durationTicks - moving.tick + 1;
  const inGap = engine.advance([
    { playerId: 'ghost', move: { x: 1, z: 0 }, facingRadians: 0, action: false },
  ], ticksUntilGap).checkpoint;
  assert.ok(inGap.lightningReveal);
  const frozenPosition = { ...inGap.lightningReveal.position };
  const movedBehindSnapshot = engine.advance([], 2).checkpoint;
  const ghostAfterSnapshot = movedBehindSnapshot.players.find((player) => player.role === 'ghost');
  assert.ok(ghostAfterSnapshot && movedBehindSnapshot.lightningReveal);
  assert.ok(ghostAfterSnapshot.position.x > frozenPosition.x);
  assert.deepEqual(movedBehindSnapshot.lightningReveal.position, frozenPosition);
});

test('lightning exposure does not prevent contact capture', () => {
  const engine = new MatchEngine({
    seed: 109,
    map: {
      ...OPEN_MAP,
      ghostSpawn: { x: 0, z: 0 },
      childSpawns: [
        { x: 0.95, z: 0 },
        OPEN_MAP.childSpawns[1],
        OPEN_MAP.childSpawns[2],
        OPEN_MAP.childSpawns[3],
      ],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });
  engine.setPlayerActive('child', false);
  engine.advance([], engine.checkpoint().nextLightningPlayingTick);
  assert.ok(engine.checkpoint().lightningReveal);

  engine.setPlayerActive('child', true);
  const captured = engine.advance([], MATCH_RULES.captureContactTicks).checkpoint;
  assert.equal(captured.phase, 'capture-animation');
  assert.equal(captured.captureCount, 1);
  assert.equal(captured.ghostBurnTicksRemaining, 0);
  assert.equal(captured.lightningReveal, null);
});

test('a strike remains resumable in the final frame while ended rules clear its reveal', () => {
  const engine = new MatchEngine({
    seed: 113,
    map: { ...OPEN_MAP, ghostSpawn: { x: 1.5, z: 0 } },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });
  const flashlightOn = {
    playerId: 'child',
    move: { x: 0, z: 0 },
    facingRadians: 0,
    action: true,
  } as const;
  const lethalFlashlightTicks =
    (MATCH_RULES.ghostMaxHealth / MATCH_RULES.flashlightDamagePerSecond) * MATCH_RULES.tickRate;
  engine.advance([flashlightOn], lethalFlashlightTicks - 1);
  engine.advance([{ ...flashlightOn, action: false }]);
  let checkpoint = engine.checkpoint();
  engine.advance([], checkpoint.nextLightningPlayingTick - checkpoint.lightningPlayingTick);
  assert.ok(engine.checkpoint().lightningReveal);

  checkpoint = engine.advance([flashlightOn]).checkpoint;
  assert.equal(checkpoint.phase, 'ended');
  assert.ok(checkpoint.lightning, 'the final frame must retain the pending visual/audio schedule');
  assert.equal(checkpoint.lightningReveal, null, 'ended rules must not keep exposing the ghost');
});

test('a child moves at the fixed 60 Hz rules speed', () => {
  const engine = new MatchEngine({
    seed: 7,
    map: OPEN_MAP,
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  engine.advance(
    [{ playerId: 'child', move: { x: 1, z: 0 }, facingRadians: 0, action: false }],
    MATCH_RULES.tickRate,
  );

  const child = engine.checkpoint().players.find((player) => player.id === 'child');
  assert.ok(child);
  assertApproximately(child.position.x, MATCH_RULES.childMoveSpeed);
  assert.equal(child.position.z, 0);
});

test('development gameplay tuning changes the authoritative simulation speed', () => {
  const engine = new MatchEngine({
    seed: 7,
    map: OPEN_MAP,
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });
  engine.setGameplayTuning({ childMoveSpeed: 5.25, ghostMoveSpeed: 5.8 });

  engine.advance(
    [{ playerId: 'child', move: { x: 1, z: 0 }, facingRadians: 0, action: false }],
    MATCH_RULES.tickRate,
  );

  const child = engine.checkpoint().players.find((player) => player.id === 'child');
  assert.ok(child);
  assertApproximately(child.position.x, 5.25);
});

test('a moving player slides along a wall instead of crossing it', () => {
  const engine = new MatchEngine({
    seed: 7,
    map: {
      ...OPEN_MAP,
      walls: [{ id: 'divider', minX: 1, maxX: 1.2, minZ: -10, maxZ: 10 }],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  engine.advance(
    [{ playerId: 'child', move: { x: 1, z: 1 }, facingRadians: 0, action: false }],
    MATCH_RULES.tickRate,
  );

  const child = engine.checkpoint().players.find((player) => player.id === 'child');
  assert.ok(child);
  assert.ok(child.position.x <= 1 - MATCH_RULES.mapCollisionRadius);
  assert.ok(child.position.z > 2);
});

test('a player can pass a doorway when grazing its frame', () => {
  const engine = new MatchEngine({
    seed: 7,
    map: {
      ...OPEN_MAP,
      walls: [
        { id: 'divider-left', minX: 0, maxX: 0.2, minZ: -5, maxZ: -0.6 },
        { id: 'divider-right', minX: 0, maxX: 0.2, minZ: 0.6, maxZ: 5 },
      ],
      childSpawns: [
        { x: -1, z: 0.2 },
        OPEN_MAP.childSpawns[1],
        OPEN_MAP.childSpawns[2],
        OPEN_MAP.childSpawns[3],
      ],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  engine.advance(
    [{ playerId: 'child', move: { x: 1, z: 0 }, facingRadians: 0, action: false }],
    MATCH_RULES.tickRate,
  );

  const child = engine.checkpoint().players.find((player) => player.id === 'child');
  assert.ok(child);
  assert.ok(child.position.x > 0.2 + MATCH_RULES.mapCollisionRadius);
  assert.equal(child.position.z, 0.2);
});

test('one human player cannot move through another human player', () => {
  const engine = new MatchEngine({
    seed: 7,
    map: {
      ...OPEN_MAP,
      childSpawns: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        OPEN_MAP.childSpawns[2],
        OPEN_MAP.childSpawns[3],
      ],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['moving-child', 'blocking-child'],
  });

  engine.advance(
    [{ playerId: 'moving-child', move: { x: 1, z: 0 }, facingRadians: 0, action: false }],
    MATCH_RULES.tickRate,
  );

  const checkpoint = engine.checkpoint();
  const moving = checkpoint.players.find((player) => player.id === 'moving-child');
  const blocking = checkpoint.players.find((player) => player.id === 'blocking-child');
  assert.ok(moving && blocking);
  assert.ok(blocking.position.x - moving.position.x >= MATCH_RULES.playerRadius * 2);
});

test('empty child slots become non-blocking sensing dolls', () => {
  const engine = new MatchEngine({
    seed: 7,
    map: {
      ...OPEN_MAP,
      childSpawns: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        OPEN_MAP.childSpawns[2],
        OPEN_MAP.childSpawns[3],
      ],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  engine.advance(
    [{ playerId: 'child', move: { x: 1, z: 0 }, facingRadians: 0, action: false }],
    MATCH_RULES.tickRate,
  );

  const checkpoint = engine.checkpoint();
  const child = checkpoint.players.find((player) => player.id === 'child');
  assert.ok(child);
  assert.equal(checkpoint.dolls.length, 3);
  assert.ok(child.position.x > 1 + MATCH_RULES.playerRadius);
});

test('a held flashlight consumes battery and damages and reveals an unobstructed ghost', () => {
  const engine = new MatchEngine({
    seed: 7,
    map: {
      ...OPEN_MAP,
      ghostSpawn: { x: 1.5, z: 0 },
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  engine.advance(
    [{ playerId: 'child', move: { x: 0, z: 0 }, facingRadians: 0, action: true }],
    MATCH_RULES.tickRate,
  );

  const checkpoint = engine.checkpoint();
  const child = checkpoint.players.find((player) => player.id === 'child');
  assert.ok(child);
  assertApproximately(child.battery, 0.875);
  assertApproximately(
    checkpoint.ghostHealth,
    MATCH_RULES.ghostMaxHealth - MATCH_RULES.flashlightDamagePerSecond,
  );
  assert.equal(checkpoint.ghostRevealed, true);
});

test('infinite debug tuning preserves flashlight energy and ghost health without disabling illumination', () => {
  const engine = new MatchEngine({
    seed: 7,
    map: {
      ...OPEN_MAP,
      ghostSpawn: { x: 1.5, z: 0 },
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
    gameplayTuning: {
      infiniteGhostHealth: true,
      infiniteFlashlightEnergy: true,
    },
  });

  const result = engine.advance(
    [{ playerId: 'child', move: { x: 0, z: 0 }, facingRadians: 0, action: true }],
    MATCH_RULES.tickRate * 2,
  );
  const child = result.checkpoint.players.find((player) => player.id === 'child');
  assert.ok(child);
  assert.equal(child.battery, 1);
  assert.equal(result.checkpoint.ghostHealth, MATCH_RULES.ghostMaxHealth);
  assert.equal(result.checkpoint.ghostRevealed, true);
  assert.equal(result.checkpoint.ghostBurnTicksRemaining, MATCH_RULES.ghostBurnDurationTicks);

  engine.setGameplayTuning({ infiniteGhostHealth: false, infiniteFlashlightEnergy: false });
  const finite = engine.advance();
  const finiteChild = finite.checkpoint.players.find((player) => player.id === 'child');
  assert.ok(finiteChild);
  assert.ok(finiteChild.battery < 1);
  assert.ok(finite.checkpoint.ghostHealth < MATCH_RULES.ghostMaxHealth);
});

test('a wall blocks flashlight damage but not battery drain', () => {
  const engine = new MatchEngine({
    seed: 7,
    map: {
      ...OPEN_MAP,
      ghostSpawn: { x: 1.5, z: 0 },
      walls: [{ id: 'beam-blocker', minX: 0.7, maxX: 0.8, minZ: -1, maxZ: 1 }],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  engine.advance(
    [{ playerId: 'child', move: { x: 0, z: 0 }, facingRadians: 0, action: true }],
    MATCH_RULES.tickRate,
  );

  const checkpoint = engine.checkpoint();
  const child = checkpoint.players.find((player) => player.id === 'child');
  assert.ok(child);
  assertApproximately(child.battery, 0.875);
  assert.equal(checkpoint.ghostHealth, MATCH_RULES.ghostMaxHealth);
  assert.equal(checkpoint.ghostRevealed, false);
});

test('additional flashlights add diminishing damage', () => {
  const engine = new MatchEngine({
    seed: 7,
    map: {
      ...OPEN_MAP,
      ghostSpawn: { x: 0, z: 0 },
      childSpawns: [
        { x: -1.5, z: 0 },
        { x: 1.5, z: 0 },
        OPEN_MAP.childSpawns[2],
        OPEN_MAP.childSpawns[3],
      ],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['left-child', 'right-child'],
  });

  engine.advance(
    [
      { playerId: 'left-child', move: { x: 0, z: 0 }, facingRadians: 0, action: true },
      { playerId: 'right-child', move: { x: 0, z: 0 }, facingRadians: Math.PI, action: true },
    ],
    MATCH_RULES.tickRate,
  );

  const expectedDamage =
    MATCH_RULES.flashlightDamagePerSecond *
    (MATCH_RULES.beamDamageMultipliers[0] + MATCH_RULES.beamDamageMultipliers[1]);
  assertApproximately(engine.checkpoint().ghostHealth, MATCH_RULES.ghostMaxHealth - expectedDamage);
});

test('an illuminated ghost moves twenty percent slower', () => {
  const engine = new MatchEngine({
    seed: 7,
    map: {
      ...OPEN_MAP,
      ghostSpawn: { x: 0, z: 0 },
      childSpawns: [
        { x: -1.5, z: 0 },
        OPEN_MAP.childSpawns[1],
        OPEN_MAP.childSpawns[2],
        OPEN_MAP.childSpawns[3],
      ],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  engine.advance([
    { playerId: 'child', move: { x: 0, z: 0 }, facingRadians: 0, action: true },
    { playerId: 'ghost', move: { x: 0, z: 1 }, facingRadians: 0, action: false },
  ]);

  const ghost = engine.checkpoint().players.find((player) => player.id === 'ghost');
  assert.ok(ghost);
  assertApproximately(
    ghost.position.z,
    (MATCH_RULES.ghostMoveSpeed * MATCH_RULES.illuminatedGhostSpeedMultiplier) / MATCH_RULES.tickRate,
  );
});

test('a burning ghost can flee but cannot capture until the burn lock expires', () => {
  const engine = new MatchEngine({
    seed: 9,
    map: {
      ...OPEN_MAP,
      ghostSpawn: { x: 0, z: 0 },
      childSpawns: [
        { x: 0.95, z: 0 },
        OPEN_MAP.childSpawns[1],
        OPEN_MAP.childSpawns[2],
        OPEN_MAP.childSpawns[3],
      ],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  const ignited = engine.advance([
    { playerId: 'child', move: { x: 0, z: 0 }, facingRadians: Math.PI, action: true },
    { playerId: 'ghost', move: { x: 0, z: 1 }, facingRadians: 0, action: false },
  ]);
  const fleeingGhost = ignited.checkpoint.players.find((player) => player.id === 'ghost');
  assert.ok(fleeingGhost);
  assert.ok(fleeingGhost.position.z > 0, 'burning must not prevent the ghost from fleeing');
  assert.equal(ignited.checkpoint.ghostBurnTicksRemaining, MATCH_RULES.ghostBurnDurationTicks);
  assert.equal(ignited.checkpoint.captureCount, 0);

  const almostRecovered = engine.advance(
    [
      { playerId: 'child', move: { x: 0, z: 0 }, facingRadians: Math.PI, action: false },
      { playerId: 'ghost', move: { x: 0, z: 0 }, facingRadians: 0, action: false },
    ],
    MATCH_RULES.ghostBurnDurationTicks - 1,
  );
  assert.equal(almostRecovered.checkpoint.ghostBurnTicksRemaining, 1);
  assert.equal(almostRecovered.checkpoint.captureCount, 0);

  const recovered = engine.advance();
  assert.equal(recovered.checkpoint.ghostBurnTicksRemaining, 0);
  assert.equal(recovered.checkpoint.captureCount, 0);
  assert.equal(recovered.checkpoint.captureContactTicks, 1);

  const captured = engine.advance([], MATCH_RULES.captureContactTicks - 1);
  assert.equal(captured.checkpoint.captureCount, 1);
});

test('gameplay tuning controls headlamp range and flashlight cone reach', () => {
  const engine = new MatchEngine({
    seed: 10,
    map: {
      ...OPEN_MAP,
      ghostSpawn: { x: 3, z: Math.sqrt(3) },
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });
  engine.setGameplayTuning({
    headlampDetectionRange: 3,
    flashlightLength: 4,
    flashlightConeDegrees: 60,
  });

  const before = engine.checkpoint();
  const child = before.players.find((player) => player.id === 'child');
  assert.ok(child);
  assert.equal(child.headlamp, 'off');

  const illuminated = engine.advance([
    { playerId: 'child', move: { x: 0, z: 0 }, facingRadians: 0, action: true },
  ]);
  assert.ok(illuminated.checkpoint.ghostHealth < MATCH_RULES.ghostMaxHealth);
  assert.equal(illuminated.checkpoint.ghostBurnTicksRemaining, MATCH_RULES.ghostBurnDurationTicks);
});

function createCaptureEngine(): MatchEngine {
  return new MatchEngine({
    seed: 11,
    map: {
      ...OPEN_MAP,
      ghostSpawn: { x: 0, z: 0 },
      childSpawns: [
        { x: 2.2, z: 0 },
        OPEN_MAP.childSpawns[1],
        OPEN_MAP.childSpawns[2],
        OPEN_MAP.childSpawns[3],
      ],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });
}

function approachCapture(
  engine: MatchEngine,
  ghostFacing = Math.PI,
  ghostAction = false,
): MatchAdvanceResult {
  for (let tick = 0; tick < MATCH_RULES.tickRate; tick += 1) {
    const result = engine.advance([
      { playerId: 'ghost', move: { x: 1, z: 0 }, facingRadians: ghostFacing, action: ghostAction },
      { playerId: 'child', move: { x: 0, z: 0 }, facingRadians: Math.PI, action: false },
    ]);
    if (result.checkpoint.phase === 'capture-animation') return result;
  }
  throw new Error('Ghost did not reach contact range within one second.');
}

function finishResetAndProtection(engine: MatchEngine): void {
  engine.advance([], MATCH_RULES.captureAnimationTicks + MATCH_RULES.protectionTicks);
}

test('sustained contact captures without an action or facing requirement', () => {
  const engine = createCaptureEngine();

  const result = approachCapture(engine, Math.PI, false);
  assert.equal(result.checkpoint.captureCount, 1);
  assert.equal(result.checkpoint.phase, 'capture-animation');
  assert.equal(result.checkpoint.capturedChildPlayerId, 'child');
  assert.ok(result.events.some((event) => event.type === 'child-captured' && event.childPlayerId === 'child'));
});

test('capture contact must persist for the full dwell and resets after separation', () => {
  const engine = new MatchEngine({
    seed: 12,
    map: {
      ...OPEN_MAP,
      ghostSpawn: { x: 0, z: 0 },
      childSpawns: [
        { x: 0.95, z: 0 },
        OPEN_MAP.childSpawns[1],
        OPEN_MAP.childSpawns[2],
        OPEN_MAP.childSpawns[3],
      ],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  engine.advance([], MATCH_RULES.captureContactTicks - 1);
  assert.equal(engine.checkpoint().captureCount, 0);
  assert.equal(engine.checkpoint().captureContactChildPlayerId, 'child');
  assert.equal(engine.checkpoint().captureContactTicks, MATCH_RULES.captureContactTicks - 1);

  engine.advance([
    { playerId: 'child', move: { x: 1, z: 0 }, facingRadians: 0, action: false },
  ]);
  assert.equal(engine.checkpoint().captureContactChildPlayerId, null);
  assert.equal(engine.checkpoint().captureContactTicks, 0);
  assert.equal(engine.checkpoint().captureCount, 0);
});

test('the former capture range does not count until bodies make contact', () => {
  const engine = new MatchEngine({
    seed: 11,
    map: {
      ...OPEN_MAP,
      ghostSpawn: { x: 0, z: 0 },
      childSpawns: [
        { x: 1.2, z: 0 },
        OPEN_MAP.childSpawns[1],
        OPEN_MAP.childSpawns[2],
        OPEN_MAP.childSpawns[3],
      ],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  engine.advance([{ playerId: 'ghost', move: { x: 0, z: 0 }, facingRadians: 0, action: true }], 30);
  assert.equal(engine.checkpoint().captureCount, 0);
  assert.equal(engine.checkpoint().phase, 'playing');
});

test('a capture pauses the clock, resets positions, and preserves progress through protection', () => {
  const engine = createCaptureEngine();
  engine.advance(
    [
      { playerId: 'ghost', move: { x: 0, z: 1 }, facingRadians: 0, action: false },
      { playerId: 'child', move: { x: 0, z: 1 }, facingRadians: Math.PI, action: true },
    ],
    10,
  );
  engine.advance([
    { playerId: 'ghost', move: { x: 0, z: 0 }, facingRadians: 0, action: false },
    { playerId: 'child', move: { x: 0, z: 0 }, facingRadians: Math.PI, action: false },
  ]);
  engine.advance([], MATCH_RULES.ghostBurnDurationTicks);
  approachCapture(engine);

  const captured = engine.checkpoint();
  const remainingAfterCapture = captured.remainingTicks;
  const healthAfterCapture = captured.ghostHealth;
  const batteryAfterCapture = captured.players.find((player) => player.id === 'child')?.battery;
  finishResetAndProtection(engine);

  const reset = engine.checkpoint();
  const ghost = reset.players.find((player) => player.id === 'ghost');
  const child = reset.players.find((player) => player.id === 'child');
  assert.ok(ghost && child);
  assert.equal(reset.phase, 'playing');
  assert.equal(reset.remainingTicks, remainingAfterCapture);
  assert.equal(reset.ghostHealth, healthAfterCapture);
  assert.equal(child.battery, batteryAfterCapture);
  assert.deepEqual(ghost.position, { x: 0, z: 0 });
  assert.deepEqual(child.position, { x: 2.2, z: 0 });
  assert.equal(reset.capturedChildPlayerId, null);
});

test('protection lets children create distance while the ghost remains frozen', () => {
  const engine = createCaptureEngine();
  approachCapture(engine);
  engine.advance([], MATCH_RULES.captureAnimationTicks);
  assert.equal(engine.checkpoint().phase, 'protection');

  const before = engine.checkpoint();
  const ghostBefore = before.players.find((player) => player.id === 'ghost');
  const childBefore = before.players.find((player) => player.id === 'child');
  assert.ok(ghostBefore && childBefore);
  engine.advance([
    { playerId: 'ghost', move: { x: 1, z: 0 }, facingRadians: 0, action: false },
    { playerId: 'child', move: { x: 1, z: 0 }, facingRadians: 0, action: true },
  ], MATCH_RULES.tickRate / 2);

  const protectedFrame = engine.checkpoint();
  const ghostAfter = protectedFrame.players.find((player) => player.id === 'ghost');
  const childAfter = protectedFrame.players.find((player) => player.id === 'child');
  assert.ok(ghostAfter && childAfter);
  assert.deepEqual(ghostAfter.position, ghostBefore.position);
  assert.ok(childAfter.position.x > childBefore.position.x);
  assert.equal(childAfter.battery, childBefore.battery, 'flashlights stay inactive during protection');
  assert.equal(protectedFrame.remainingTicks, before.remainingTicks);
  assert.equal(protectedFrame.phase, 'protection');
});

test('the third capture plays its full cinematic before ghost victory', () => {
  const engine = createCaptureEngine();

  approachCapture(engine);
  finishResetAndProtection(engine);
  approachCapture(engine);
  finishResetAndProtection(engine);
  approachCapture(engine);

  assert.equal(engine.checkpoint().captureCount, 3);
  assert.equal(engine.checkpoint().winner, null);
  assert.equal(engine.checkpoint().phase, 'capture-animation');

  engine.advance([], MATCH_RULES.captureAnimationTicks);
  assert.equal(engine.checkpoint().winner, 'ghost');
  assert.equal(engine.checkpoint().phase, 'ended');
});

test('headlamps report ghost distance without wall occlusion', () => {
  const engine = new MatchEngine({
    seed: 17,
    map: {
      ...OPEN_MAP,
      ghostSpawn: { x: 0, z: 0 },
      childSpawns: [
        { x: 5, z: 0 },
        { x: 3, z: 0 },
        { x: 1.5, z: 0 },
        { x: 8, z: 0 },
      ],
      walls: [{ id: 'irrelevant-wall', minX: 0.5, maxX: 0.7, minZ: -2, maxZ: 2 }],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  const checkpoint = engine.checkpoint();
  const child = checkpoint.players.find((player) => player.id === 'child');
  assert.ok(child);
  assert.equal(child.headlamp, 'fast');
  assert.deepEqual(
    checkpoint.dolls.map((doll) => doll.headlamp),
    ['fast', 'solid', 'off'],
  );
});

test('charge below 70 percent creates one battery and below 50 percent creates two', () => {
  const engine = new MatchEngine({
    seed: 23,
    map: {
      ...OPEN_MAP,
      batterySpawns: [
        { x: 3, z: 3 },
        { x: -3, z: 3 },
        { x: 3, z: -3 },
      ],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  const firstSpawn = engine.advance(
    [{ playerId: 'child', move: { x: 0, z: 0 }, facingRadians: Math.PI, action: true }],
    145,
  );
  assert.equal(firstSpawn.checkpoint.batteries.length, 1);
  assert.ok(firstSpawn.events.some((event) => event.type === 'battery-spawned'));

  const firstBatteryId = firstSpawn.checkpoint.batteries[0].id;
  const secondSpawn = engine.advance([], 96);
  assert.equal(secondSpawn.checkpoint.batteries.length, 2);
  assert.equal(secondSpawn.checkpoint.batteries[0].id, firstBatteryId);
  assert.equal(new Set(secondSpawn.checkpoint.batteries.map((battery) => battery.spawnIndex)).size, 2);
  assert.ok(secondSpawn.events.some((event) => event.type === 'battery-spawned'));
});

test('only a child can collect a battery and refill to full charge', () => {
  const engine = new MatchEngine({
    seed: 23,
    map: {
      ...OPEN_MAP,
      batterySpawns: [{ x: 0, z: 0 }],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  engine.advance(
    [{ playerId: 'child', move: { x: 0, z: 0 }, facingRadians: Math.PI, action: true }],
    145,
  );
  const collected = engine.advance([
    { playerId: 'child', move: { x: 0, z: 0 }, facingRadians: Math.PI, action: false },
  ]);

  const child = collected.checkpoint.players.find((player) => player.id === 'child');
  assert.ok(child);
  assert.equal(child.battery, 1);
  assert.deepEqual(collected.checkpoint.batteries, []);
  assert.equal(collected.checkpoint.battery, null);
  assert.ok(collected.events.some((event) => event.type === 'battery-collected'));
});

test('a spawned battery survives capture reset', () => {
  const engine = new MatchEngine({
    seed: 23,
    map: {
      ...OPEN_MAP,
      ghostSpawn: { x: 0, z: 0 },
      childSpawns: [
        { x: 1.2, z: 0 },
        OPEN_MAP.childSpawns[1],
        OPEN_MAP.childSpawns[2],
        OPEN_MAP.childSpawns[3],
      ],
      batterySpawns: [{ x: 5, z: 5 }],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  engine.advance(
    [{ playerId: 'child', move: { x: 0, z: 0 }, facingRadians: 0, action: true }],
    409,
  );
  const batteryBeforeCapture = engine.checkpoint().battery;
  assert.ok(batteryBeforeCapture);
  engine.advance([{ playerId: 'child', move: { x: 0, z: 0 }, facingRadians: 0, action: false }]);
  approachCapture(engine);
  finishResetAndProtection(engine);

  assert.deepEqual(engine.checkpoint().battery, batteryBeforeCapture);
});

test('the five-minute rules clock ending gives children victory', () => {
  const engine = new MatchEngine({
    seed: 29,
    map: OPEN_MAP,
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  const result = engine.advance([], MATCH_RULES.matchDurationTicks);

  assert.equal(result.checkpoint.remainingTicks, 0);
  assert.equal(result.checkpoint.winner, 'children');
  assert.ok(result.events.some((event) => event.type === 'match-ended' && event.winner === 'children'));
});

test('lethal flashlight damage resolves before contact capture on the same tick', () => {
  const engine = new MatchEngine({
    seed: 29,
    map: {
      ...OPEN_MAP,
      ghostSpawn: { x: 0, z: 0 },
      childSpawns: [
        { x: 1, z: 0 },
        OPEN_MAP.childSpawns[1],
        OPEN_MAP.childSpawns[2],
        OPEN_MAP.childSpawns[3],
      ],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });
  engine.advance(
    [{ playerId: 'child', move: { x: 0, z: 0 }, facingRadians: Math.PI, action: true }],
    479,
  );
  const result = engine.advance([
    { playerId: 'child', move: { x: 0, z: 0 }, facingRadians: Math.PI, action: true },
    { playerId: 'ghost', move: { x: 1, z: 0 }, facingRadians: Math.PI, action: true },
  ]);

  assert.equal(result.checkpoint.ghostHealth, 0);
  assert.equal(result.checkpoint.captureCount, 0);
  assert.equal(result.checkpoint.winner, 'children');
});

test('the same seed and command tape produce the same checkpoint and events', () => {
  const setup = {
    seed: 31,
    map: {
      ...OPEN_MAP,
      batterySpawns: [
        { x: 3, z: 3 },
        { x: -3, z: 3 },
        { x: 3, z: -3 },
      ],
    },
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  } as const;
  const left = new MatchEngine(setup);
  const right = new MatchEngine(setup);
  const command = {
    playerId: 'child',
    move: { x: 0, z: 0 },
    facingRadians: Math.PI,
    action: true,
  } as const;

  const leftResult = left.advance([command], 409);
  const rightResult = right.advance([command], 409);

  assert.deepEqual(leftResult, rightResult);
});

test('the default greybox house supplies four peripheral slots and legal battery points', () => {
  const engine = new MatchEngine({
    seed: 37,
    map: DEFAULT_HOUSE_MAP,
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  const checkpoint = engine.checkpoint();
  assert.equal(DEFAULT_HOUSE_MAP.childSpawns.length, 4);
  assert.ok(DEFAULT_HOUSE_MAP.walls.length >= 8);
  assert.ok(DEFAULT_HOUSE_MAP.batterySpawns.length >= 6);
  assert.ok(DEFAULT_HOUSE_MAP.bounds.maxX - DEFAULT_HOUSE_MAP.bounds.minX >= 30);
  assert.ok(DEFAULT_HOUSE_MAP.bounds.maxZ - DEFAULT_HOUSE_MAP.bounds.minZ >= 18);
  assert.equal(checkpoint.dolls.length, 3);
});

test('match setup rejects invalid player rosters and commands', () => {
  assert.throws(
    () =>
      new MatchEngine({
        seed: 41,
        map: OPEN_MAP,
        ghostPlayerId: 'same-player',
        childPlayerIds: ['same-player'],
      }),
    /unique/i,
  );
  assert.throws(
    () =>
      new MatchEngine({ seed: 41, map: OPEN_MAP, ghostPlayerId: 'ghost', childPlayerIds: [] }),
    /one to four/i,
  );

  const engine = new MatchEngine({
    seed: 41,
    map: OPEN_MAP,
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });
  assert.throws(
    () =>
      engine.advance([
        { playerId: 'intruder', move: { x: 1, z: 0 }, facingRadians: 0, action: false },
      ]),
    /unknown player/i,
  );
});

test('accepted commands cannot be mutated by the caller after submission', () => {
  const engine = new MatchEngine({
    seed: 43,
    map: OPEN_MAP,
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });
  const command = {
    playerId: 'child',
    move: { x: 1, z: 0 },
    facingRadians: 0,
    action: false,
  };

  engine.advance([command]);
  command.move.x = 0;
  engine.advance([], MATCH_RULES.tickRate - 1);

  const child = engine.checkpoint().players.find((player) => player.id === 'child');
  assert.ok(child);
  assertApproximately(child.position.x, MATCH_RULES.childMoveSpeed);
});

test('an inactive child becomes nonblocking and cannot be captured or use a flashlight', () => {
  const map: MatchMap = {
    ...OPEN_MAP,
    ghostSpawn: { x: 0, z: 0 },
    childSpawns: [{ x: 1, z: 0 }, { x: 4, z: 4 }, { x: -4, z: 4 }, { x: 4, z: -4 }],
  };
  const engine = new MatchEngine({
    seed: 47,
    map,
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });
  engine.setPlayerActive('child', false);
  engine.advance([
    { playerId: 'child', move: { x: 0, z: 0 }, facingRadians: Math.PI, action: true },
    { playerId: 'ghost', move: { x: 1, z: 0 }, facingRadians: 0, action: true },
  ], MATCH_RULES.tickRate);

  const checkpoint = engine.checkpoint();
  const ghost = checkpoint.players.find((player) => player.id === 'ghost');
  const child = checkpoint.players.find((player) => player.id === 'child');
  assert.ok(ghost);
  assert.ok(child);
  assert.equal(child.active, false);
  assert.ok(ghost.position.x > 1, 'the inactive child must not block movement');
  assert.equal(checkpoint.captureCount, 0);
  assert.equal(checkpoint.ghostHealth, MATCH_RULES.ghostMaxHealth);
});
