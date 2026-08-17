import assert from 'node:assert/strict';
import test from 'node:test';
import { EventLedger } from '../../src/net/EventLedger';
import type { MatchEventEnvelope } from '../../src/net/protocol';

test('event IDs are deduplicated within a match and may repeat in a new match', () => {
  const ledger = new EventLedger();
  const first: MatchEventEnvelope = {
    matchId: 'one',
    events: [{ id: 1, tick: 2, type: 'capture-started' }],
  };
  assert.equal(ledger.accept(first).length, 1);
  assert.equal(ledger.accept(first).length, 0);
  assert.equal(ledger.accept({ ...first, matchId: 'two' }).length, 1);
});
