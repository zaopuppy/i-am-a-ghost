import * as THREE from 'three';
import type { HouseMaterialKit } from '../assets/MaterialLibrary';
import {
  DEFAULT_HOUSE_MAP,
  HOUSE_OPENINGS,
  HOUSE_ROOMS,
  ROOM_FAMILY_BY_ID,
  type HouseRoomLabel,
  type RoomFamily,
} from './defaultHouse';

const WALL_HEIGHT = 3.4;
const DOOR_HEIGHT = 2.15;
const POST_SIZE = 0.11;
const ROOM_WIDTH = 9.3;
const ROOM_DEPTH = 5.8;

export function buildHouseStage(materials: HouseMaterialKit): THREE.Group {
  const root = new THREE.Group();
  root.name = 'house-stage';
  root.add(buildRoomFloors(materials));
  root.add(buildOpenings(materials));
  root.add(buildWallDressing(materials));
  root.add(buildWindows(materials));
  return root;
}

function buildRoomFloors(materials: HouseMaterialKit): THREE.Group {
  const group = new THREE.Group();
  group.name = 'room-floors';
  const geometry = new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH);
  for (const room of HOUSE_ROOMS) {
    const family = familyOf(room);
    const tile = new THREE.Mesh(geometry, materials.roomFloors[family]);
    tile.name = `room-floor-${room.id}`;
    tile.rotation.x = -Math.PI / 2;
    tile.position.set(room.center.x, 0.006, room.center.z);
    tile.receiveShadow = true;
    group.add(tile);
  }
  return group;
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

function buildWallDressing(materials: HouseMaterialKit): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wall-dressing';
  const frameGeometry = new THREE.BoxGeometry(0.72, 0.52, 0.05);
  const shelfGeometry = new THREE.BoxGeometry(1.15, 0.08, 0.07);
  const cribGeometry = new THREE.BoxGeometry(0.9, 0.62, 0.06);

  for (const room of HOUSE_ROOMS) {
    const family = familyOf(room);
    const material = materials.dressing[family];
    const insets = dressingInsets(room);
    for (const [index, inset] of insets.entries()) {
      let mesh: THREE.Mesh;
      if (family === 'old') {
        mesh = new THREE.Mesh(shelfGeometry, material);
        mesh.position.set(inset.x, 1.12 + (index % 2) * 0.42, inset.z);
      } else if (family === 'sleep' && index === 0) {
        mesh = new THREE.Mesh(cribGeometry, material);
        mesh.position.set(inset.x, 0.72, inset.z);
      } else {
        mesh = new THREE.Mesh(frameGeometry, material);
        mesh.position.set(inset.x, 1.38, inset.z);
      }
      mesh.rotation.y = inset.yaw;
      mesh.name = `dressing-${room.id}-${index}`;
      group.add(mesh);
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

function dressingInsets(room: HouseRoomLabel): Array<{ x: number; z: number; yaw: number }> {
  const { x, z } = room.center;
  return [
    { x: x - 2.1, z: z + ROOM_DEPTH / 2 - 0.16, yaw: 0 },
    { x: x + 2.1, z: z + ROOM_DEPTH / 2 - 0.16, yaw: 0 },
    { x: x + ROOM_WIDTH / 2 - 0.16, z: z, yaw: -Math.PI / 2 },
  ];
}

function familyOf(room: HouseRoomLabel): RoomFamily {
  return ROOM_FAMILY_BY_ID[room.id] ?? 'old';
}

export const HOUSE_STAGE_WALL_HEIGHT = WALL_HEIGHT;
