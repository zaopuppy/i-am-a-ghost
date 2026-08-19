import * as THREE from 'three';
import { loadFurnitureLibrary } from '../assets/EnvironmentAssets';
import type { HouseMaterialKit } from '../assets/MaterialLibrary';
import {
  COMPILED_DEFAULT_HOUSE,
  DEFAULT_HOUSE_MAP,
  HOUSE_OPENINGS,
  HOUSE_ROOMS,
  ROOM_FAMILY_BY_ID,
  type RoomFamily,
} from './defaultHouse';

const DOOR_HEIGHT = 2.15;
const POST_SIZE = 0.11;

export interface HouseStageBuild {
  root: THREE.Group;
  ready: Promise<void>;
  furnitureCount: number;
}

export const HOUSE_FURNITURE_COUNT = COMPILED_DEFAULT_HOUSE.furniture.length;

export function buildHouseStage(materials: HouseMaterialKit): HouseStageBuild {
  const root = new THREE.Group();
  root.name = 'house-stage';
  root.add(buildRoomFloors(materials));
  root.add(buildRoomInlays(materials));
  root.add(buildOpenings(materials));
  root.add(buildWindows(materials));
  const furniture = new THREE.Group();
  furniture.name = 'room-furniture';
  root.add(furniture);
  return {
    root,
    ready: populateFurniture(furniture, materials),
    furnitureCount: COMPILED_DEFAULT_HOUSE.furniture.length,
  };
}

function buildRoomFloors(materials: HouseMaterialKit): THREE.Group {
  const group = new THREE.Group();
  group.name = 'room-floors';
  for (const room of HOUSE_ROOMS) {
    const geometry = new THREE.PlaneGeometry(room.width, room.depth);
    const tile = new THREE.Mesh(geometry, materials.roomFloors[familyOf(room.id)]);
    tile.name = `room-floor-${room.id}`;
    tile.rotation.x = -Math.PI / 2;
    tile.position.set(room.center.x, 0.006, room.center.z);
    tile.receiveShadow = true;
    group.add(tile);
  }
  return group;
}

function buildRoomInlays(materials: HouseMaterialKit): THREE.LineSegments {
  const vertices: number[] = [];
  for (const room of HOUSE_ROOMS) {
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

function buildOpenings(materials: HouseMaterialKit): THREE.Group {
  const group = new THREE.Group();
  group.name = 'house-openings';
  const postGeometry = new THREE.BoxGeometry(POST_SIZE, DOOR_HEIGHT, POST_SIZE);
  const thresholdGeometry = new THREE.PlaneGeometry(1, 1);

  for (const opening of HOUSE_OPENINGS) {
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

function buildWindows(materials: HouseMaterialKit): THREE.Group {
  const group = new THREE.Group();
  group.name = 'window-glows';
  const geometry = new THREE.PlaneGeometry(1.35, 1.05);
  const bounds = DEFAULT_HOUSE_MAP.bounds;
  const windows: Array<{ x: number; z: number; yaw: number }> = [
    { x: bounds.minX + 0.08, z: -6.7, yaw: Math.PI / 2 },
    { x: bounds.minX + 0.08, z: 6.7, yaw: Math.PI / 2 },
    { x: bounds.maxX - 0.08, z: -6.7, yaw: -Math.PI / 2 },
    { x: bounds.maxX - 0.08, z: 6.7, yaw: -Math.PI / 2 },
    { x: -10.5, z: bounds.minZ + 0.08, yaw: 0 },
    { x: 10.5, z: bounds.minZ + 0.08, yaw: 0 },
    { x: -10.5, z: bounds.maxZ - 0.08, yaw: Math.PI },
    { x: 10.5, z: bounds.maxZ - 0.08, yaw: Math.PI },
  ];
  for (const [index, window] of windows.entries()) {
    const pane = new THREE.Mesh(geometry, materials.windowGlow);
    pane.name = `window-glow-${index}`;
    pane.position.set(window.x, 1.55, window.z);
    pane.rotation.y = window.yaw;
    group.add(pane);
  }
  return group;
}

async function populateFurniture(group: THREE.Group, materials: HouseMaterialKit): Promise<void> {
  const library = await loadFurnitureLibrary(materials);
  for (const placement of COMPILED_DEFAULT_HOUSE.furniture) {
    const root = library.instantiate(placement.asset, familyOf(placement.roomId));
    root.name = `furniture-${placement.id}`;
    root.position.set(placement.position.x, placement.elevation, placement.position.z);
    root.rotation.y = placement.yawRadians;
    root.scale.setScalar(placement.scale);
    group.add(root);
  }
}

function familyOf(roomId: string): RoomFamily {
  return ROOM_FAMILY_BY_ID[roomId] ?? 'old';
}
