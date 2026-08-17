import type { MatchMap, Vec2 } from './MatchEngine';

export interface HouseRoomLabel {
  id: string;
  name: string;
  center: Vec2;
}

export const HOUSE_ROOMS: readonly HouseRoomLabel[] = [
  { id: 'nursery', name: '育婴室', center: { x: -10.5, z: -6.7 } },
  { id: 'dining', name: '餐厅', center: { x: 0, z: -6.7 } },
  { id: 'pantry', name: '储藏室', center: { x: 10.5, z: -6.7 } },
  { id: 'library', name: '书房', center: { x: -10.5, z: 0 } },
  { id: 'foyer', name: '门厅', center: { x: 0, z: 0 } },
  { id: 'parlor', name: '会客室', center: { x: 10.5, z: 0 } },
  { id: 'bedroom', name: '卧室', center: { x: -10.5, z: 6.7 } },
  { id: 'gallery', name: '画廊', center: { x: 0, z: 6.7 } },
  { id: 'study', name: '旧书斋', center: { x: 10.5, z: 6.7 } },
];

export const DEFAULT_HOUSE_MAP: MatchMap = {
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
    { x: 0, z: -7 },
    { x: 0, z: 7 },
    { x: -8, z: -6.5 },
    { x: 8, z: -6.5 },
    { x: -8, z: 6.5 },
    { x: 8, z: 6.5 },
    { x: -2.2, z: 0 },
    { x: 2.2, z: 0 },
  ],
};
