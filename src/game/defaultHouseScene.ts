import {
  HOUSE_SCENE_VERSION,
  type FurniturePlacement,
  type HouseRoomDefinition,
  type HouseSceneDefinition,
} from './HouseScene';

const columns = {
  west: { center: -10.45, size: 10.7 },
  center: { center: 0, size: 9.8 },
  east: { center: 10.45, size: 10.7 },
} as const;
const rows = {
  south: { center: -6.7, size: 6.2 },
  center: { center: 0, size: 6.8 },
  north: { center: 6.7, size: 6.2 },
} as const;

const rooms: HouseRoomDefinition[] = [
  room('nursery', '育婴室', 'sleep', 'west', 'south'),
  room('dining', '餐厅', 'living', 'center', 'south'),
  room('pantry', '储藏室', 'old', 'east', 'south'),
  room('library', '书房', 'old', 'west', 'center'),
  room('foyer', '门厅', 'living', 'center', 'center'),
  room('parlor', '会客室', 'living', 'east', 'center'),
  room('bedroom', '卧室', 'sleep', 'west', 'north'),
  room('gallery', '画廊', 'old', 'center', 'north'),
  room('study', '旧书斋', 'old', 'east', 'north'),
];

const furniture: FurniturePlacement[] = [
  placement('nursery-bed', 'nursery', 'bed_single_A', 0, -1.3),
  placement('nursery-cabinet', 'nursery', 'cabinet_medium_decorated', -4, 1.4, Math.PI / 2),
  placement('nursery-rug', 'nursery', 'rug_oval_A', 1, 1.1),

  placement('dining-rug', 'dining', 'rug_rectangle_stripes_A', 0, -1.45),
  placement('dining-table', 'dining', 'table_medium_long', 0, -1.45),
  placement('dining-chair-west', 'dining', 'chair_A_wood', -2, -1.45, -Math.PI / 2),
  placement('dining-chair-east', 'dining', 'chair_A_wood', 2, -1.45, Math.PI / 2),
  placement('dining-chair-south', 'dining', 'chair_A_wood', 1.25, 0.5, Math.PI),

  placement('pantry-shelf-north', 'pantry', 'shelf_B_large_decorated', 4, -1.4, -Math.PI / 2),
  placement('pantry-shelf-south', 'pantry', 'shelf_B_large_decorated', 4, 1, -Math.PI / 2),
  placement('pantry-cabinet', 'pantry', 'cabinet_medium_decorated', -3.1, -1.8, Math.PI),

  placement('library-shelf-north', 'library', 'shelf_B_large_decorated', -4, -1.5, Math.PI / 2),
  placement('library-shelf-south', 'library', 'shelf_B_large_decorated', -4, 1.3, Math.PI / 2),
  placement('library-rug', 'library', 'rug_rectangle_A', -0.3, 1.2),
  placement('library-chair', 'library', 'armchair_pillows', -2.4, 1.7, -Math.PI / 4),
  placement('library-lamp', 'library', 'lamp_standing', -3.6, 1.8),

  placement('foyer-rug', 'foyer', 'rug_oval_A', 0, 0),

  placement('parlor-rug', 'parlor', 'rug_rectangle_A', -0.3, 1.1),
  placement('parlor-couch', 'parlor', 'couch_pillows', -2.1, 2),
  placement('parlor-chair-north', 'parlor', 'armchair_pillows', 2.7, 2, Math.PI / 2),
  placement('parlor-chair-south', 'parlor', 'armchair_pillows', 2.6, -1.7, Math.PI * 0.75),
  placement('parlor-table', 'parlor', 'table_low', 0.4, 0.9),

  placement('bedroom-bed', 'bedroom', 'bed_double_A', 3, 1.7, 0, 0.8),
  placement('bedroom-cabinet', 'bedroom', 'cabinet_medium_decorated', -4, -1.5, Math.PI / 2),

  placement('gallery-rug', 'gallery', 'rug_rectangle_stripes_A', 0, -0.4),
  placement('gallery-console', 'gallery', 'table_low', 0, 2.25, 0, 0.8),
  placement('gallery-frame-west', 'gallery', 'pictureframe_standing_A', -0.65, 2.25, 0, 0.9, 0.4),
  placement('gallery-frame-center', 'gallery', 'pictureframe_standing_A', 0, 2.25, 0, 0.9, 0.4),
  placement('gallery-frame-east', 'gallery', 'pictureframe_standing_A', 0.65, 2.25, 0, 0.9, 0.4),

  placement('study-rug', 'study', 'rug_rectangle_A', -1.5, 1.1),
  placement('study-shelf', 'study', 'shelf_B_large_decorated', 4, 1.3, -Math.PI / 2),
  placement('study-desk', 'study', 'table_medium', 0.8, 1.3),
  placement('study-chair', 'study', 'chair_A_wood', 0.8, -0.1),
  placement('study-lamp', 'study', 'lamp_table', 0.8, 1.3, 0, 0.65, 1),
];

export const DEFAULT_HOUSE_SCENE: HouseSceneDefinition = {
  version: HOUSE_SCENE_VERSION,
  id: 'm3-nine-room-house',
  bounds: { minX: -16, maxX: 16, minZ: -10, maxZ: 10 },
  walls: [
    { id: 'left-lower-a', minX: -5.1, maxX: -4.9, minZ: -10, maxZ: -5.6 },
    { id: 'left-lower-b', minX: -5.1, maxX: -4.9, minZ: -4, maxZ: 1.2 },
    { id: 'left-upper-a', minX: -5.1, maxX: -4.9, minZ: 2.8, maxZ: 7.1 },
    { id: 'left-upper-b', minX: -5.1, maxX: -4.9, minZ: 8.7, maxZ: 10 },
    { id: 'right-lower-a', minX: 4.9, maxX: 5.1, minZ: -10, maxZ: -7.5 },
    { id: 'right-lower-b', minX: 4.9, maxX: 5.1, minZ: -5.9, maxZ: -0.8 },
    { id: 'right-upper-a', minX: 4.9, maxX: 5.1, minZ: 0.8, maxZ: 5.5 },
    { id: 'right-upper-b', minX: 4.9, maxX: 5.1, minZ: 7.1, maxZ: 10 },
    { id: 'lower-west-a', minX: -16, maxX: -12, minZ: -3.6, maxZ: -3.4 },
    { id: 'lower-west-b', minX: -10, maxX: -3, minZ: -3.6, maxZ: -3.4 },
    { id: 'lower-east-a', minX: -1, maxX: 7, minZ: -3.6, maxZ: -3.4 },
    { id: 'lower-east-b', minX: 9, maxX: 16, minZ: -3.6, maxZ: -3.4 },
    { id: 'upper-west-a', minX: -16, maxX: -9, minZ: 3.4, maxZ: 3.6 },
    { id: 'upper-west-b', minX: -7, maxX: 0, minZ: 3.4, maxZ: 3.6 },
    { id: 'upper-east-a', minX: 2, maxX: 10, minZ: 3.4, maxZ: 3.6 },
    { id: 'upper-east-b', minX: 12, maxX: 16, minZ: 3.4, maxZ: 3.6 },
    { id: 'northwest-dead-end', minX: -11.2, maxX: -11, minZ: 5.2, maxZ: 10 },
    { id: 'southeast-dead-end', minX: 11, maxX: 11.2, minZ: -10, maxZ: -5.2 },
  ],
  rooms,
  furniture,
  ghostSpawn: { x: 0, z: 0 },
  childSpawns: [
    { x: -13.5, z: -7.2 },
    { x: 13.5, z: -7.2 },
    { x: -13.5, z: 7.2 },
    { x: 13.5, z: 7.2 },
  ],
  batterySpawns: [
    { x: -13, z: 0 },
    { x: 13, z: 0 },
    { x: 0, z: -6 },
    { x: 0, z: 7 },
    { x: -8, z: -6.5 },
    { x: 8, z: -6.5 },
    { x: -8, z: 6.5 },
    { x: 8, z: 6.5 },
    { x: -2.2, z: 0 },
    { x: 2.2, z: 0 },
  ],
};

function room(
  id: string,
  name: string,
  family: HouseRoomDefinition['family'],
  columnId: keyof typeof columns,
  rowId: keyof typeof rows,
): HouseRoomDefinition {
  const column = columns[columnId];
  const row = rows[rowId];
  return {
    id,
    name,
    family,
    center: { x: column.center, z: row.center },
    width: column.size,
    depth: row.size,
  };
}

function placement(
  id: string,
  roomId: string,
  asset: FurniturePlacement['asset'],
  offsetX: number,
  offsetZ: number,
  yawRadians = 0,
  scale = 1,
  elevation?: number,
): FurniturePlacement {
  return { id, roomId, asset, offsetX, offsetZ, yawRadians, scale, elevation };
}
