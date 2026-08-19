import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPILED_DEFAULT_HOUSE } from '../../src/game/defaultHouse';
import {
  cloneHouseScene,
  compileHouseScene,
  FURNITURE_CATALOG,
} from '../../src/game/HouseScene';
import { DEFAULT_HOUSE_SCENE } from '../../src/game/defaultHouseScene';

test('the default scene compiles into one valid render and collision definition', () => {
  assert.deepEqual(COMPILED_DEFAULT_HOUSE.issues, []);
  assert.equal(COMPILED_DEFAULT_HOUSE.rooms.length, 9);
  assert.equal(COMPILED_DEFAULT_HOUSE.openings.length, 12);
  assert.equal(COMPILED_DEFAULT_HOUSE.furniture.length, 34);
  assert.equal(COMPILED_DEFAULT_HOUSE.map.movementObstacles?.length, 22);
});

test('decorative floor and tabletop assets remain non-blocking', () => {
  assert.equal(FURNITURE_CATALOG.rug_oval_A.collider, null);
  assert.equal(FURNITURE_CATALOG.rug_rectangle_A.collider, null);
  assert.equal(FURNITURE_CATALOG.lamp_table.collider, null);
  assert.equal(FURNITURE_CATALOG.pictureframe_standing_A.collider, null);
});

test('the compiler rejects furniture placed inside a doorway safety zone', () => {
  const scene = cloneHouseScene(DEFAULT_HOUSE_SCENE);
  const cabinet = scene.furniture.find((placement) => placement.id === 'pantry-cabinet');
  assert.ok(cabinet);
  cabinet.offsetX = -3.4;
  cabinet.offsetZ = 2;

  const compiled = compileHouseScene(scene);

  assert.ok(compiled.issues.some((issue) =>
    issue.severity === 'error'
    && issue.code === 'door-blocked'
    && issue.subjectId === cabinet.id,
  ));
});

test('wall-aligned furniture fits inside the room up to the structural inner face', () => {
  const scene = cloneHouseScene(DEFAULT_HOUSE_SCENE);
  const nursery = scene.rooms.find((room) => room.id === 'nursery');
  assert.ok(nursery);
  scene.furniture.push({
    id: 'wall-aligned-table',
    roomId: nursery.id,
    asset: 'table_small',
    offsetX: -15.39 - nursery.center.x,
    offsetZ: -9 - nursery.center.z,
  });

  const compiled = compileHouseScene(scene);

  assert.ok(!compiled.issues.some((issue) =>
    issue.code === 'outside-room'
    && issue.subjectId === 'wall-aligned-table',
  ));
});

test('scene clones can be edited without mutating the shipped house', () => {
  const clone = cloneHouseScene(DEFAULT_HOUSE_SCENE);
  clone.rooms[0].center.x += 3;
  clone.furniture[0].yawRadians = Math.PI;

  assert.notEqual(clone.rooms[0].center.x, DEFAULT_HOUSE_SCENE.rooms[0].center.x);
  assert.notEqual(clone.furniture[0].yawRadians, DEFAULT_HOUSE_SCENE.furniture[0].yawRadians);
});
