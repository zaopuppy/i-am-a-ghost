import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_HOUSE_MAP } from '../../src/game/defaultHouse';
import { MATCH_RULES, MatchEngine, type MatchMap } from '../../src/game/MatchEngine';

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
  assert.ok(child.position.x <= 1 - MATCH_RULES.playerRadius);
  assert.ok(child.position.z > 2);
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
  assertApproximately(checkpoint.ghostHealth, 87.5);
  assert.equal(checkpoint.ghostRevealed, true);
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

function createCaptureEngine(): MatchEngine {
  return new MatchEngine({
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
}

function pressCapture(engine: MatchEngine): void {
  engine.advance([{ playerId: 'ghost', move: { x: 0, z: 0 }, facingRadians: 0, action: false }]);
  engine.advance(
    [{ playerId: 'ghost', move: { x: 0, z: 0 }, facingRadians: 0, action: true }],
    MATCH_RULES.captureWindupTicks,
  );
}

function finishResetAndProtection(engine: MatchEngine): void {
  engine.advance([], MATCH_RULES.captureAnimationTicks + MATCH_RULES.protectionTicks);
}

test('capture resolves only after its windup', () => {
  const engine = createCaptureEngine();

  engine.advance(
    [{ playerId: 'ghost', move: { x: 0, z: 0 }, facingRadians: 0, action: true }],
    MATCH_RULES.captureWindupTicks - 1,
  );
  assert.equal(engine.checkpoint().captureCount, 0);
  assert.equal(engine.checkpoint().ghostAction.state, 'windup');

  const result = engine.advance();
  assert.equal(result.checkpoint.captureCount, 1);
  assert.equal(result.checkpoint.phase, 'capture-animation');
  assert.ok(result.events.some((event) => event.type === 'child-captured'));
});

test('a missed capture enters cooldown and holding space does not repeat it', () => {
  const engine = new MatchEngine({
    seed: 11,
    map: OPEN_MAP,
    ghostPlayerId: 'ghost',
    childPlayerIds: ['child'],
  });

  const result = engine.advance(
    [{ playerId: 'ghost', move: { x: 0, z: 0 }, facingRadians: 0, action: true }],
    MATCH_RULES.captureWindupTicks,
  );
  assert.equal(result.checkpoint.ghostAction.state, 'cooldown');
  assert.ok(result.events.some((event) => event.type === 'capture-missed'));

  engine.advance([], MATCH_RULES.captureMissCooldownTicks * 2);
  assert.equal(engine.checkpoint().captureCount, 0);
  assert.equal(engine.checkpoint().ghostAction.state, 'idle');
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
  pressCapture(engine);

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
  assert.deepEqual(child.position, { x: 1.2, z: 0 });
});

test('three captures give the ghost victory', () => {
  const engine = createCaptureEngine();

  pressCapture(engine);
  finishResetAndProtection(engine);
  pressCapture(engine);
  finishResetAndProtection(engine);
  pressCapture(engine);

  assert.equal(engine.checkpoint().captureCount, 3);
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
  assert.equal(child.headlamp, 'slow');
  assert.deepEqual(
    checkpoint.dolls.map((doll) => doll.headlamp),
    ['fast', 'solid', 'off'],
  );
});

test('low charge creates at most one deterministic battery', () => {
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

  const spawned = engine.advance(
    [{ playerId: 'child', move: { x: 0, z: 0 }, facingRadians: Math.PI, action: true }],
    409,
  );
  assert.ok(spawned.checkpoint.battery);
  assert.ok(spawned.events.some((event) => event.type === 'battery-spawned'));

  const batteryId = spawned.checkpoint.battery.id;
  engine.advance([], 30);
  assert.equal(engine.checkpoint().battery?.id, batteryId);
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
    409,
  );
  const collected = engine.advance([
    { playerId: 'child', move: { x: 0, z: 0 }, facingRadians: Math.PI, action: false },
  ]);

  const child = collected.checkpoint.players.find((player) => player.id === 'child');
  assert.ok(child);
  assert.equal(child.battery, 1);
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
  pressCapture(engine);
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

test('children win when lethal light and a third capture resolve on the same tick', () => {
  const engine = createCaptureEngine();
  pressCapture(engine);
  finishResetAndProtection(engine);
  pressCapture(engine);
  finishResetAndProtection(engine);

  engine.advance(
    [{ playerId: 'child', move: { x: 0, z: 0 }, facingRadians: Math.PI, action: true }],
    479,
  );
  engine.advance([
    { playerId: 'child', move: { x: 0, z: 0 }, facingRadians: Math.PI, action: false },
    { playerId: 'ghost', move: { x: 0, z: 0 }, facingRadians: 0, action: false },
  ]);
  engine.advance(
    [{ playerId: 'ghost', move: { x: 0, z: 0 }, facingRadians: 0, action: true }],
    MATCH_RULES.captureWindupTicks - 1,
  );
  const result = engine.advance([
    { playerId: 'child', move: { x: 0, z: 0 }, facingRadians: Math.PI, action: true },
  ]);

  assert.equal(result.checkpoint.ghostHealth, 0);
  assert.equal(result.checkpoint.captureCount, 2);
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
