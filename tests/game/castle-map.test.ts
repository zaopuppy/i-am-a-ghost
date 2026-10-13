import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';
import castleSource from '../../assets/maps/midnight-castle.scene.json' with { type: 'json' };
import { houseScene, usesAuthoredCastleEnvironment } from '../../src/game/HouseCatalog';
import { cloneHouseScene, compileHouseScene } from '../../src/game/HouseScene';
import { mapPositionIsOpen, mapSegmentIsOpen } from '../../src/game/MapCollision';
import { MATCH_RULES, type MatchMap, type Vec2 } from '../../src/game/MatchEngine';

const castle = houseScene('midnight-castle');

test('chapel players can cross between the altar and front pews and use both side aisles', () => {
  const paths: Array<[Vec2, Vec2]> = [
    [{ x: -4.8, z: -10.2 }, { x: 4.8, z: -10.2 }],
    [{ x: -1.7, z: -10.2 }, { x: -1.7, z: -4.9 }],
    [{ x: 1.7, z: -10.2 }, { x: 1.7, z: -4.9 }],
    [{ x: -5.1, z: -8 }, { x: 5.1, z: -8 }],
  ];
  for (const [from, to] of paths) {
    assert.ok(mapSegmentIsOpen(castle.map, from, to,
      MATCH_RULES.playerRadius, MATCH_RULES.mapCollisionRadius),
    `A player cannot traverse the chapel aisle ${JSON.stringify({ from, to })}`);
  }
  const altar = castle.furniture.find((item) => item.id === 'chapel-altar')!.collider!;
  const frontPews = castle.furniture.filter((item) => item.id.startsWith('chapel-pew-'))
    .sort((left, right) => left.position.z - right.position.z).slice(0, 2);
  for (const pew of frontPews) {
    const gap = pew.position.z - pew.collider!.halfDepth - (altar.center.z + altar.halfDepth);
    assert.ok(gap >= 1.25, `Altar-to-pew clear width is only ${gap.toFixed(3)}m`);
  }
});

test('banquet chairs face their adjacent table rather than the outer room wall', () => {
  const tables = castle.furniture.filter((item) => item.id.startsWith('banquet-table-'));
  const chairs = castle.furniture.filter((item) => item.id.startsWith('banquet-chair-'));
  assert.equal(chairs.length, 4);
  for (const chair of chairs) {
    const table = tables.find((candidate) => Math.sign(candidate.position.x) === Math.sign(chair.position.x))!;
    // The authored chair's seat front is local game +Z; its back is -Z.
    const front = { x: Math.sin(chair.yawRadians), z: Math.cos(chair.yawRadians) };
    const toward = { x: table.position.x - chair.position.x, z: table.position.z - chair.position.z };
    const alignment = (front.x * toward.x + front.z * toward.z) / Math.hypot(toward.x, toward.z);
    assert.ok(alignment > 0.85, `${chair.id} points away from its table (alignment=${alignment.toFixed(3)})`);
  }
});

test('the library chair faces its desk and chapel pews face the altar', () => {
  const chair = castle.furniture.find((item) => item.id === 'library-chair')!;
  const desk = castle.furniture.find((item) => item.id === 'library-desk')!;
  const forward = { x: Math.sin(chair.yawRadians), z: Math.cos(chair.yawRadians) };
  const toward = { x: desk.position.x - chair.position.x, z: desk.position.z - chair.position.z };
  assert.ok(forward.x * toward.x + forward.z * toward.z > 0, 'The library chair faces away from its desk.');
  for (const pew of castle.furniture.filter((item) => item.id.startsWith('chapel-pew-'))) {
    assert.ok(Math.cos(pew.yawRadians) < -0.95, `${pew.id} faces away from the altar.`);
  }
});

test('the castle is the canonical seven-room 32 by 24 metre map with usable spawn points', () => {
  assert.deepEqual(castle.definition, castleSource);
  assert.deepEqual(castle.issues, []);
  assert.equal(castle.rooms.length, 7);
  assert.equal(castle.map.bounds.maxX - castle.map.bounds.minX, 32);
  assert.equal(castle.map.bounds.maxZ - castle.map.bounds.minZ, 24);
  assert.equal(castle.map.childSpawns.length, 4);
  assert.equal(castle.map.batterySpawns.length, 10);
  assert.equal(castle.map.movementObstacles?.length, castle.furniture.length);
  assertProtectedPointsConnected(castle.map);
});

test('castle doorways fit players and each single blocked doorway retains an alternate route', () => {
  assert.ok(castle.openings.length >= 10, 'Two loops need more connections than a seven-room tree.');
  for (const opening of castle.openings) {
    const center = { x: (opening.minX + opening.maxX) / 2, z: (opening.minZ + opening.maxZ) / 2 };
    const across = opening.axis === 'x' ? { x: 0.8, z: 0 } : { x: 0, z: 0.8 };
    assert.ok(mapSegmentIsOpen(castle.map,
      { x: center.x - across.x, z: center.z - across.z },
      { x: center.x + across.x, z: center.z + across.z },
      MATCH_RULES.playerRadius, MATCH_RULES.mapCollisionRadius), `Blocked doorway ${opening.id}`);
    assertProtectedPointsConnected({
      ...castle.map,
      walls: [...castle.map.walls, { ...opening, id: `closed:${opening.id}` }],
    });
  }
});

test('castle furniture blocks movement at its collider while floor and doorway centers stay traversable', () => {
  for (const obstacle of castle.map.movementObstacles ?? []) {
    assert.equal(mapPositionIsOpen(castle.map, obstacle.center, MATCH_RULES.playerRadius), false, obstacle.id);
  }
  assert.equal(mapPositionIsOpen(castle.map, castle.map.ghostSpawn, MATCH_RULES.playerRadius), true);
});

test('edited castle geometry uses the procedural preview rather than stale authored meshes', () => {
  assert.equal(usesAuthoredCastleEnvironment(castle), true);
  const spawnEdit = cloneHouseScene(castle.definition);
  spawnEdit.ghostSpawn.x += 0.1;
  assert.equal(usesAuthoredCastleEnvironment(compileHouseScene(spawnEdit)), true);
  for (const mutate of [
    (scene: typeof spawnEdit) => { scene.walls[0].maxX -= 0.1; },
    (scene: typeof spawnEdit) => { scene.furniture[0].offsetX += 0.1; },
    (scene: typeof spawnEdit) => { scene.rooms[0].width -= 0.1; },
  ]) {
    const scene = cloneHouseScene(castle.definition);
    mutate(scene);
    assert.equal(usesAuthoredCastleEnvironment(compileHouseScene(scene)), false);
  }
});

test('the shipped Blender GLB places every furniture proxy in game coordinates with matching collision footprints', () => {
  const bytes = readFileSync(new URL('../../public/assets/models/midnight-castle/midnight-castle.glb', import.meta.url));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'Expected a binary glTF file.');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, 'First GLB chunk must contain JSON.');
  interface GltfNode {
    name?: string;
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    children?: number[];
    extras?: Record<string, unknown>;
  }
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
    scene?: number;
    scenes: Array<{ nodes: number[] }>;
    nodes: GltfNode[];
  };
  const proxies = new Map<string, { node: GltfNode; position: Vector3 }>();
  const visit = (index: number, parent: Matrix4): void => {
    const node = gltf.nodes[index];
    const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
      new Vector3().fromArray(node.translation ?? [0, 0, 0]),
      new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
      new Vector3().fromArray(node.scale ?? [1, 1, 1]),
    );
    const world = parent.clone().multiply(local);
    if (node.name?.startsWith('proxy-')) {
      const id = String(node.extras?.placementId);
      assert.notEqual(id, 'undefined', `Missing placementId metadata on ${node.name}`);
      assert.equal(proxies.has(id), false, `Duplicate Blender collision proxy ${id}`);
      proxies.set(id, { node, position: new Vector3().setFromMatrixPosition(world) });
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const index of gltf.scenes[gltf.scene ?? 0].nodes) visit(index, new Matrix4());
  assert.equal(proxies.size, castle.furniture.length);
  for (const placement of castle.furniture) {
    const proxy = proxies.get(placement.id);
    assert.ok(proxy, `Missing Blender collision proxy ${placement.id}`);
    const collider = placement.collider;
    assert.ok(collider);
    assert.ok(Math.abs(proxy.position.x - collider.center.x) < 1e-5, `X axis mismatch ${placement.id}`);
    assert.ok(Math.abs(proxy.position.z - collider.center.z) < 1e-5, `Z axis mismatch ${placement.id}`);
    assert.ok(Math.abs(proxy.position.y) < 1e-5, `Non-grounded proxy ${placement.id}`);
    assert.equal(proxy.node.extras?.game_x, collider.center.x);
    assert.equal(proxy.node.extras?.game_z, collider.center.z);
    assert.equal(proxy.node.extras?.roomId, placement.roomId);
    assert.equal(proxy.node.extras?.asset, placement.asset);
    assert.ok(Math.abs(Number(proxy.node.extras?.halfWidth) - collider.halfWidth) < 1e-6);
    assert.ok(Math.abs(Number(proxy.node.extras?.halfDepth) - collider.halfDepth) < 1e-6);
    const yaw = Number(proxy.node.extras?.yawRadians);
    assert.ok(Math.abs(Math.sin(yaw) - Math.sin(collider.yawRadians)) < 1e-6, placement.id);
    assert.ok(Math.abs(Math.cos(yaw) - Math.cos(collider.yawRadians)) < 1e-6, placement.id);
  }
});

function assertProtectedPointsConnected(map: MatchMap): void {
  const spacing = 0.4;
  const nodes: Vec2[] = [];
  const byCell = new Map<string, number>();
  const cells: Array<[number, number]> = [];
  for (let iz = 0, z = map.bounds.minZ + 0.6; z < map.bounds.maxZ - 0.5; iz += 1, z += spacing) {
    for (let ix = 0, x = map.bounds.minX + 0.6; x < map.bounds.maxX - 0.5; ix += 1, x += spacing) {
      if (!mapPositionIsOpen(map, { x, z }, MATCH_RULES.playerRadius, MATCH_RULES.mapCollisionRadius)) continue;
      byCell.set(`${ix}:${iz}`, nodes.length);
      cells.push([ix, iz]);
      nodes.push({ x, z });
    }
  }
  const nearest = (point: Vec2): number => {
    let closest = -1;
    let distance = Infinity;
    nodes.forEach((node, index) => {
      const candidate = Math.hypot(node.x - point.x, node.z - point.z);
      if (candidate >= distance || !mapSegmentIsOpen(map, point, node,
        MATCH_RULES.playerRadius, MATCH_RULES.mapCollisionRadius)) return;
      closest = index;
      distance = candidate;
    });
    assert.ok(closest >= 0, `No reachable navigation cell at ${JSON.stringify(point)}`);
    return closest;
  };
  const visited = new Set([nearest(map.ghostSpawn)]);
  const queue = [...visited];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const [ix, iz] = cells[current];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = byCell.get(`${ix + dx}:${iz + dz}`);
      if (next === undefined || visited.has(next) || !mapSegmentIsOpen(map, nodes[current], nodes[next],
        MATCH_RULES.playerRadius, MATCH_RULES.mapCollisionRadius)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  for (const point of map.childSpawns) {
    assert.ok(visited.has(nearest(point)), `Unreachable point ${JSON.stringify(point)}`);
  }
  for (const point of map.batterySpawns) {
    assert.ok(nodes.some((node, index) => visited.has(index)
      && Math.hypot(node.x - point.x, node.z - point.z) < MATCH_RULES.batteryPickupRadius),
    `Battery cannot be collected at ${JSON.stringify(point)}`);
  }
}
