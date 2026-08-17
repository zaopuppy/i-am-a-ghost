import type { MatchMap } from './MatchEngine';

export const DEFAULT_HOUSE_MAP: MatchMap = {
  id: 'm1-greybox-house',
  bounds: { minX: -11, maxX: 11, minZ: -7, maxZ: 7 },
  walls: [
    { id: 'west-divider-north', minX: -4.1, maxX: -3.9, minZ: 1.2, maxZ: 7 },
    { id: 'west-divider-south', minX: -4.1, maxX: -3.9, minZ: -7, maxZ: -1.2 },
    { id: 'east-divider-north', minX: 3.9, maxX: 4.1, minZ: 1.5, maxZ: 7 },
    { id: 'east-divider-south', minX: 3.9, maxX: 4.1, minZ: -7, maxZ: -1.5 },
    { id: 'north-west-room', minX: -11, maxX: -6.2, minZ: 2.9, maxZ: 3.1 },
    { id: 'north-center-room', minX: -4.5, maxX: 1.2, minZ: 2.9, maxZ: 3.1 },
    { id: 'north-east-room', minX: 2.7, maxX: 11, minZ: 2.9, maxZ: 3.1 },
    { id: 'south-west-room', minX: -11, maxX: -7, minZ: -3.1, maxZ: -2.9 },
    { id: 'south-center-room', minX: -5.5, maxX: 4.5, minZ: -3.1, maxZ: -2.9 },
    { id: 'south-east-room', minX: 6, maxX: 11, minZ: -3.1, maxZ: -2.9 },
  ],
  ghostSpawn: { x: 0, z: 0 },
  childSpawns: [
    { x: -8.5, z: -5 },
    { x: 8.5, z: -5 },
    { x: -8.5, z: 5 },
    { x: 8.5, z: 5 },
  ],
  batterySpawns: [
    { x: -8, z: 0 },
    { x: 8, z: 0 },
    { x: 0, z: -5 },
    { x: 0, z: 5 },
    { x: -6, z: -5 },
    { x: 6, z: -5 },
    { x: -6, z: 5 },
    { x: 6, z: 5 },
  ],
};
