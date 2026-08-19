import * as THREE from 'three';
import {
  loadFurnitureLibrary,
  type FurnitureAssetId,
} from '../assets/EnvironmentAssets';
import type { HouseMaterialKit } from '../assets/MaterialLibrary';
import {
  DEFAULT_HOUSE_MAP,
  HOUSE_OPENINGS,
  HOUSE_ROOMS,
  ROOM_FAMILY_BY_ID,
  type RoomFamily,
} from './defaultHouse';

const DOOR_HEIGHT = 2.15;
const POST_SIZE = 0.11;
const ROOM_WIDTH = 9.3;
const ROOM_DEPTH = 5.8;

interface FurniturePlacement {
  id: string;
  roomId: string;
  asset: FurnitureAssetId;
  offsetX: number;
  offsetZ: number;
  yaw?: number;
  scale?: number;
  elevation?: number;
}

export interface HouseStageBuild {
  root: THREE.Group;
  ready: Promise<void>;
  furnitureCount: number;
}

const FURNITURE_PLACEMENTS: readonly FurniturePlacement[] = [
  { id: 'nursery-bed', roomId: 'nursery', asset: 'bed_single_A', offsetX: -1.2, offsetZ: -1.3 },
  {
    id: 'nursery-cabinet',
    roomId: 'nursery',
    asset: 'cabinet_medium_decorated',
    offsetX: -4,
    offsetZ: 1.4,
    yaw: Math.PI / 2,
  },
  { id: 'nursery-rug', roomId: 'nursery', asset: 'rug_oval_A', offsetX: 1, offsetZ: 1.1 },

  {
    id: 'dining-rug',
    roomId: 'dining',
    asset: 'rug_rectangle_stripes_A',
    offsetX: 0,
    offsetZ: -1.45,
  },
  {
    id: 'dining-table',
    roomId: 'dining',
    asset: 'table_medium_long',
    offsetX: 0,
    offsetZ: -1.45,
  },
  {
    id: 'dining-chair-west',
    roomId: 'dining',
    asset: 'chair_A_wood',
    offsetX: -2,
    offsetZ: -1.45,
    yaw: -Math.PI / 2,
  },
  {
    id: 'dining-chair-east',
    roomId: 'dining',
    asset: 'chair_A_wood',
    offsetX: 2,
    offsetZ: -1.45,
    yaw: Math.PI / 2,
  },
  {
    id: 'dining-chair-south',
    roomId: 'dining',
    asset: 'chair_A_wood',
    offsetX: 1.25,
    offsetZ: 0.5,
    yaw: Math.PI,
  },

  {
    id: 'pantry-shelf-north',
    roomId: 'pantry',
    asset: 'shelf_B_large_decorated',
    offsetX: 4,
    offsetZ: -1.4,
    yaw: -Math.PI / 2,
  },
  {
    id: 'pantry-shelf-south',
    roomId: 'pantry',
    asset: 'shelf_B_large_decorated',
    offsetX: 4,
    offsetZ: 1,
    yaw: -Math.PI / 2,
  },
  {
    id: 'pantry-cabinet',
    roomId: 'pantry',
    asset: 'cabinet_medium_decorated',
    offsetX: 2.7,
    offsetZ: 2,
    yaw: Math.PI,
  },

  {
    id: 'library-shelf-north',
    roomId: 'library',
    asset: 'shelf_B_large_decorated',
    offsetX: -4,
    offsetZ: -1.5,
    yaw: Math.PI / 2,
  },
  {
    id: 'library-shelf-south',
    roomId: 'library',
    asset: 'shelf_B_large_decorated',
    offsetX: -4,
    offsetZ: 1.3,
    yaw: Math.PI / 2,
  },
  {
    id: 'library-rug',
    roomId: 'library',
    asset: 'rug_rectangle_A',
    offsetX: -0.3,
    offsetZ: 1.2,
  },
  {
    id: 'library-chair',
    roomId: 'library',
    asset: 'armchair_pillows',
    offsetX: -2.4,
    offsetZ: 1.7,
    yaw: -Math.PI / 4,
  },
  {
    id: 'library-lamp',
    roomId: 'library',
    asset: 'lamp_standing',
    offsetX: -3.6,
    offsetZ: 1.8,
  },

  { id: 'foyer-rug', roomId: 'foyer', asset: 'rug_oval_A', offsetX: 0, offsetZ: 0 },

  {
    id: 'parlor-rug',
    roomId: 'parlor',
    asset: 'rug_rectangle_A',
    offsetX: -0.3,
    offsetZ: 1.1,
  },
  { id: 'parlor-couch', roomId: 'parlor', asset: 'couch_pillows', offsetX: -2.1, offsetZ: 2 },
  {
    id: 'parlor-chair-north',
    roomId: 'parlor',
    asset: 'armchair_pillows',
    offsetX: 2.7,
    offsetZ: 2,
    yaw: -Math.PI / 2,
  },
  {
    id: 'parlor-chair-south',
    roomId: 'parlor',
    asset: 'armchair_pillows',
    offsetX: 3,
    offsetZ: -2,
    yaw: -Math.PI / 2,
  },
  { id: 'parlor-table', roomId: 'parlor', asset: 'table_low', offsetX: 0, offsetZ: 0.9 },

  {
    id: 'bedroom-bed',
    roomId: 'bedroom',
    asset: 'bed_double_A',
    offsetX: 3,
    offsetZ: 1.7,
    scale: 0.8,
  },
  {
    id: 'bedroom-cabinet',
    roomId: 'bedroom',
    asset: 'cabinet_medium_decorated',
    offsetX: -4,
    offsetZ: -1.5,
    yaw: Math.PI / 2,
  },

  {
    id: 'gallery-rug',
    roomId: 'gallery',
    asset: 'rug_rectangle_stripes_A',
    offsetX: 0,
    offsetZ: -0.4,
  },
  {
    id: 'gallery-console',
    roomId: 'gallery',
    asset: 'table_low',
    offsetX: 0,
    offsetZ: 2.25,
    scale: 0.8,
  },
  {
    id: 'gallery-frame-west',
    roomId: 'gallery',
    asset: 'pictureframe_standing_A',
    offsetX: -0.65,
    offsetZ: 2.25,
    scale: 0.9,
    elevation: 0.4,
  },
  {
    id: 'gallery-frame-center',
    roomId: 'gallery',
    asset: 'pictureframe_standing_A',
    offsetX: 0,
    offsetZ: 2.25,
    scale: 0.9,
    elevation: 0.4,
  },
  {
    id: 'gallery-frame-east',
    roomId: 'gallery',
    asset: 'pictureframe_standing_A',
    offsetX: 0.65,
    offsetZ: 2.25,
    scale: 0.9,
    elevation: 0.4,
  },

  {
    id: 'study-rug',
    roomId: 'study',
    asset: 'rug_rectangle_A',
    offsetX: -1.5,
    offsetZ: 1.1,
  },
  {
    id: 'study-shelf',
    roomId: 'study',
    asset: 'shelf_B_large_decorated',
    offsetX: 4,
    offsetZ: 1.3,
    yaw: -Math.PI / 2,
  },
  { id: 'study-desk', roomId: 'study', asset: 'table_medium', offsetX: 0.8, offsetZ: 1.3 },
  { id: 'study-chair', roomId: 'study', asset: 'chair_A_wood', offsetX: 0.8, offsetZ: -0.1 },
  {
    id: 'study-lamp',
    roomId: 'study',
    asset: 'lamp_table',
    offsetX: 0.8,
    offsetZ: 1.3,
    scale: 0.65,
    elevation: 1,
  },
];

export const HOUSE_FURNITURE_COUNT = FURNITURE_PLACEMENTS.length;

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
    furnitureCount: FURNITURE_PLACEMENTS.length,
  };
}

function buildRoomFloors(materials: HouseMaterialKit): THREE.Group {
  const group = new THREE.Group();
  group.name = 'room-floors';
  const geometry = new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH);
  for (const room of HOUSE_ROOMS) {
    const family = familyOf(room.id);
    const tile = new THREE.Mesh(geometry, materials.roomFloors[family]);
    tile.name = `room-floor-${room.id}`;
    tile.rotation.x = -Math.PI / 2;
    tile.position.set(room.center.x, 0.006, room.center.z);
    tile.receiveShadow = true;
    group.add(tile);
  }
  return group;
}

function buildRoomInlays(materials: HouseMaterialKit): THREE.LineSegments {
  const halfWidth = ROOM_WIDTH / 2 - 0.28;
  const halfDepth = ROOM_DEPTH / 2 - 0.28;
  const vertices: number[] = [];
  for (const room of HOUSE_ROOMS) {
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
  for (const placement of FURNITURE_PLACEMENTS) {
    const room = HOUSE_ROOMS.find((candidate) => candidate.id === placement.roomId);
    if (!room) throw new Error(`Unknown room ${placement.roomId} for furniture ${placement.id}.`);
    const root = library.instantiate(placement.asset, familyOf(room.id));
    root.name = `furniture-${placement.id}`;
    root.position.set(
      room.center.x + placement.offsetX,
      placement.elevation ?? 0.012,
      room.center.z + placement.offsetZ,
    );
    root.rotation.y = placement.yaw ?? 0;
    root.scale.setScalar(placement.scale ?? 1);
    group.add(root);
  }
}

function familyOf(roomId: string): RoomFamily {
  return ROOM_FAMILY_BY_ID[roomId] ?? 'old';
}
