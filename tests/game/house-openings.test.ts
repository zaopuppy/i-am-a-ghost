import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_HOUSE_MAP,
  HOUSE_OPENINGS,
  HOUSE_ROOMS,
  ROOM_FAMILY_BY_ID,
  deriveHouseOpenings,
} from '../../src/game/defaultHouse';

test('interior wall gaps become twelve doorways and ignore spur walls', () => {
  const openings = deriveHouseOpenings(DEFAULT_HOUSE_MAP.walls);
  assert.equal(openings.length, 12);
  assert.equal(HOUSE_OPENINGS.length, 12);
  assert.ok(openings.every((opening) => opening.maxX > opening.minX && opening.maxZ > opening.minZ));
  assert.equal(openings.filter((opening) => opening.axis === 'x').length, 6);
  assert.equal(openings.filter((opening) => opening.axis === 'z').length, 6);
  assert.ok(openings
    .filter((opening) => opening.axis === 'x')
    .every((opening) => Math.abs(opening.maxZ - opening.minZ - 1.92) < 1e-9));
  assert.ok(openings
    .filter((opening) => opening.axis === 'z')
    .every((opening) => Math.abs(opening.maxX - opening.minX - 2.4) < 1e-9));
});

test('every named room belongs to a stage family', () => {
  assert.equal(HOUSE_ROOMS.length, 9);
  for (const room of HOUSE_ROOMS) {
    assert.ok(ROOM_FAMILY_BY_ID[room.id], `${room.id} is missing a room family`);
  }
});
