import * as THREE from 'three';
import { CastleEnvironment, type CastleAssetMetrics } from '../assets/CastleEnvironment';
import { loadFurnitureLibrary } from '../assets/EnvironmentAssets';
import type { HouseMaterialKit } from '../assets/MaterialLibrary';
import { COMPILED_DEFAULT_HOUSE } from './defaultHouse';
import { usesAuthoredCastleEnvironment } from './HouseCatalog';
import { createHouseBoundaryWalls, type CompiledHouseScene, type RoomFamily } from './HouseScene';
import type { LightningDirection } from './MatchEngine';
import { FLASHLIGHT_OCCLUDER_LAYER, LIGHTNING_OCCLUDER_LAYER } from './RenderLayers';

const DOOR_HEIGHT = 2.15;
const POST_SIZE = 0.11;
const CASTLE_SHADOW_WALL_HEIGHT = 2.8;

export interface HouseStageBuild {
  root: THREE.Group;
  ready: Promise<void>;
  furnitureCount: number;
  windowGlows: Record<LightningDirection, THREE.MeshBasicMaterial> | null;
  castle?: CastleAssetMetrics;
  dispose?: () => void;
}

export const HOUSE_FURNITURE_COUNT = COMPILED_DEFAULT_HOUSE.furniture.length;

export function buildHouseStage(
  materials: HouseMaterialKit,
  house: CompiledHouseScene = COMPILED_DEFAULT_HOUSE,
): HouseStageBuild {
  if (usesAuthoredCastleEnvironment(house)) return buildCastleStage(materials, house);
  return buildStockHouseStage(materials, house);
}

function buildStockHouseStage(
  materials: HouseMaterialKit,
  house: CompiledHouseScene,
  isActive: () => boolean = () => true,
): HouseStageBuild {
  const root = new THREE.Group();
  root.name = 'house-stage';
  root.add(buildRoomFloors(materials, house));
  root.add(buildRoomInlays(materials, house));
  root.add(buildOpenings(materials, house));
  const windows = buildWindows(materials, house);
  root.add(windows.root);
  const furniture = new THREE.Group();
  furniture.name = 'room-furniture';
  root.add(furniture);
  return {
    root,
    ready: populateFurniture(furniture, materials, house, isActive),
    furnitureCount: house.furniture.length,
    windowGlows: windows.materials,
  };
}

function buildCastleStage(materials: HouseMaterialKit, house: CompiledHouseScene): HouseStageBuild {
  const root = new THREE.Group();
  root.name = 'house-stage';
  const castle = new CastleEnvironment();
  castle.root.name = 'castle-environment';
  root.add(castle.root);
  // The visible cutaway cannot block beams at head height. Keep full-height
  // rule walls in shadow-camera layers only, preserving the playable door gaps.
  root.add(buildCastleShadowWalls(materials, house));
  let disposed = false;
  const ready = castle.load().catch(async () => {
    if (disposed) return;
    const fallback = buildStockHouseStage(materials, house, () => !disposed);
    fallback.root.name = 'castle-fallback';
    root.add(fallback.root);
    const fallbackWalls = [
      ...house.map.walls.map((wall) => ({ wall, boundary: false })),
      ...createHouseBoundaryWalls(house.map.bounds).map((wall) => ({ wall, boundary: true })),
    ];
    for (const { wall, boundary } of fallbackWalls) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(wall.maxX - wall.minX, 1.65, wall.maxZ - wall.minZ), materials.wall);
      mesh.name = 'wall-castle-fallback';
      mesh.position.set((wall.minX + wall.maxX) / 2, 0.825, (wall.minZ + wall.maxZ) / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.layers.enable(FLASHLIGHT_OCCLUDER_LAYER);
      if (!boundary) mesh.layers.enable(LIGHTNING_OCCLUDER_LAYER);
      fallback.root.add(mesh);
    }
    await fallback.ready;
  });
  return {
    root,
    ready,
    furnitureCount: house.furniture.length,
    windowGlows: null,
    castle: castle.diagnostics,
    dispose: () => {
      disposed = true;
      castle.dispose();
    },
  };
}

function buildCastleShadowWalls(materials: HouseMaterialKit, house: CompiledHouseScene): THREE.Group {
  const root = new THREE.Group();
  root.name = 'castle-shadow-walls';
  const walls = [
    ...house.map.walls.map((wall) => ({ wall, boundary: false })),
    ...createHouseBoundaryWalls(house.map.bounds).map((wall) => ({ wall, boundary: true })),
  ];
  for (const [index, { wall, boundary }] of walls.entries()) {
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(wall.maxX - wall.minX, CASTLE_SHADOW_WALL_HEIGHT, wall.maxZ - wall.minZ),
      materials.wall,
    );
    proxy.name = `castle-shadow-${boundary ? 'boundary' : 'wall'}-${index}`;
    proxy.position.set((wall.minX + wall.maxX) / 2, CASTLE_SHADOW_WALL_HEIGHT / 2, (wall.minZ + wall.maxZ) / 2);
    proxy.castShadow = true;
    proxy.layers.set(FLASHLIGHT_OCCLUDER_LAYER);
    if (!boundary) proxy.layers.enable(LIGHTNING_OCCLUDER_LAYER);
    root.add(proxy);
  }
  return root;
}

function buildRoomFloors(materials: HouseMaterialKit, house: CompiledHouseScene): THREE.Group {
  const group = new THREE.Group();
  group.name = 'room-floors';
  for (const room of house.rooms) {
    const geometry = new THREE.PlaneGeometry(room.width, room.depth);
    const tile = new THREE.Mesh(geometry, materials.roomFloors[room.family]);
    tile.name = `room-floor-${room.id}`;
    tile.rotation.x = -Math.PI / 2;
    tile.position.set(room.center.x, 0.006, room.center.z);
    tile.receiveShadow = true;
    group.add(tile);
  }
  return group;
}

function buildRoomInlays(materials: HouseMaterialKit, house: CompiledHouseScene): THREE.LineSegments {
  const vertices: number[] = [];
  for (const room of house.rooms) {
    const halfWidth = room.width / 2 - 0.28;
    const halfDepth = room.depth / 2 - 0.28;
    const minX = room.center.x - halfWidth;
    const maxX = room.center.x + halfWidth;
    const minZ = room.center.z - halfDepth;
    const maxZ = room.center.z + halfDepth;
    vertices.push(
      minX, 0.034, minZ, maxX, 0.034, minZ,
      maxX, 0.034, minZ, maxX, 0.034, maxZ,
      maxX, 0.034, maxZ, minX, 0.034, maxZ,
      minX, 0.034, maxZ, minX, 0.034, minZ,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const inlays = new THREE.LineSegments(geometry, materials.floorTrim);
  inlays.name = 'room-floor-inlays';
  return inlays;
}

function buildOpenings(materials: HouseMaterialKit, house: CompiledHouseScene): THREE.Group {
  const group = new THREE.Group();
  group.name = 'house-openings';
  const postGeometry = new THREE.BoxGeometry(POST_SIZE, DOOR_HEIGHT, POST_SIZE);
  const thresholdGeometry = new THREE.PlaneGeometry(1, 1);

  for (const opening of house.openings) {
    const centerX = (opening.minX + opening.maxX) / 2;
    const centerZ = (opening.minZ + opening.maxZ) / 2;
    const width = opening.maxX - opening.minX;
    const depth = opening.maxZ - opening.minZ;

    const threshold = new THREE.Mesh(thresholdGeometry, materials.threshold);
    threshold.name = `${opening.id}-threshold`;
    threshold.rotation.x = -Math.PI / 2;
    threshold.position.set(centerX, 0.02, centerZ);
    if (opening.axis === 'x') {
      threshold.scale.set(0.55, Math.max(0.2, depth - 0.08), 1);
    } else {
      threshold.scale.set(Math.max(0.2, width - 0.08), 0.55, 1);
    }
    group.add(threshold);

    const postY = DOOR_HEIGHT / 2;
    const left = new THREE.Mesh(postGeometry, materials.doorFrame);
    const right = new THREE.Mesh(postGeometry, materials.doorFrame);
    if (opening.axis === 'x') {
      left.position.set(centerX, postY, opening.minZ);
      right.position.set(centerX, postY, opening.maxZ);
      const lintel = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(width, POST_SIZE), 0.12, Math.max(0.2, depth)),
        materials.doorFrame,
      );
      lintel.position.set(centerX, DOOR_HEIGHT, centerZ);
      group.add(left, right, lintel);
    } else {
      left.position.set(opening.minX, postY, centerZ);
      right.position.set(opening.maxX, postY, centerZ);
      const lintel = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.2, width), 0.12, Math.max(depth, POST_SIZE)),
        materials.doorFrame,
      );
      lintel.position.set(centerX, DOOR_HEIGHT, centerZ);
      group.add(left, right, lintel);
    }
  }
  return group;
}

function buildWindows(
  materials: HouseMaterialKit,
  house: CompiledHouseScene,
): {
  root: THREE.Group;
  materials: Record<LightningDirection, THREE.MeshBasicMaterial>;
} {
  const group = new THREE.Group();
  group.name = 'window-glows';
  const geometry = new THREE.PlaneGeometry(1.35, 1.05);
  const bounds = house.map.bounds;
  const westEastZ = [mix(bounds.minZ, bounds.maxZ, 0.165), mix(bounds.minZ, bounds.maxZ, 0.835)];
  const northSouthX = [mix(bounds.minX, bounds.maxX, 0.171875), mix(bounds.minX, bounds.maxX, 0.828125)];
  const windowMaterials = Object.fromEntries(
    (['north', 'east', 'south', 'west'] as const).map((direction) => {
      const material = materials.windowGlow.clone();
      material.name = `window-glow-${direction}`;
      return [direction, material];
    }),
  ) as Record<LightningDirection, THREE.MeshBasicMaterial>;
  const windows: Array<{
    x: number;
    z: number;
    yaw: number;
    direction: LightningDirection;
  }> = [
    { x: bounds.minX + 0.08, z: westEastZ[0], yaw: Math.PI / 2, direction: 'west' },
    { x: bounds.minX + 0.08, z: westEastZ[1], yaw: Math.PI / 2, direction: 'west' },
    { x: bounds.maxX - 0.08, z: westEastZ[0], yaw: -Math.PI / 2, direction: 'east' },
    { x: bounds.maxX - 0.08, z: westEastZ[1], yaw: -Math.PI / 2, direction: 'east' },
    { x: northSouthX[0], z: bounds.minZ + 0.08, yaw: 0, direction: 'south' },
    { x: northSouthX[1], z: bounds.minZ + 0.08, yaw: 0, direction: 'south' },
    { x: northSouthX[0], z: bounds.maxZ - 0.08, yaw: Math.PI, direction: 'north' },
    { x: northSouthX[1], z: bounds.maxZ - 0.08, yaw: Math.PI, direction: 'north' },
  ];
  for (const [index, window] of windows.entries()) {
    const pane = new THREE.Mesh(geometry, windowMaterials[window.direction]);
    pane.name = `window-glow-${index}`;
    pane.userData.lightningDirection = window.direction;
    pane.position.set(window.x, 1.55, window.z);
    pane.rotation.y = window.yaw;
    group.add(pane);
  }
  return { root: group, materials: windowMaterials };
}

async function populateFurniture(
  group: THREE.Group,
  materials: HouseMaterialKit,
  house: CompiledHouseScene,
  isActive: () => boolean,
): Promise<void> {
  const library = await loadFurnitureLibrary(materials);
  if (!isActive()) return;
  for (const placement of house.furniture) {
    const root = library.instantiate(placement.asset, familyOf(house, placement.roomId));
    root.name = `furniture-${placement.id}`;
    root.position.set(placement.position.x, placement.elevation, placement.position.z);
    root.rotation.y = placement.yawRadians;
    root.scale.setScalar(placement.scale);
    group.add(root);
  }
}

function familyOf(house: CompiledHouseScene, roomId: string): RoomFamily {
  return house.rooms.find((room) => room.id === roomId)?.family ?? 'old';
}

function mix(start: number, end: number, ratio: number): number {
  return start + (end - start) * ratio;
}
