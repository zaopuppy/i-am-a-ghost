import type { Vec2 } from './MatchEngine';
import {
  compileHouseScene,
  deriveHouseOpenings,
  type HouseOpening,
  type HouseRoomDefinition,
  type RoomFamily,
} from './HouseScene';
import { DEFAULT_HOUSE_SCENE } from './defaultHouseScene';

export type { HouseOpening, RoomFamily } from './HouseScene';

export interface HouseRoomLabel {
  id: string;
  name: string;
  center: Vec2;
  width: number;
  depth: number;
}

export const COMPILED_DEFAULT_HOUSE = compileHouseScene(DEFAULT_HOUSE_SCENE);

const defaultErrors = COMPILED_DEFAULT_HOUSE.issues.filter((issue) => issue.severity === 'error');
if (defaultErrors.length > 0) {
  throw new Error(`Default house scene is invalid: ${defaultErrors.map((issue) => issue.message).join(' ')}`);
}

export const DEFAULT_HOUSE_MAP = COMPILED_DEFAULT_HOUSE.map;
export const HOUSE_OPENINGS: readonly HouseOpening[] = COMPILED_DEFAULT_HOUSE.openings;
export const HOUSE_ROOMS: readonly HouseRoomLabel[] = COMPILED_DEFAULT_HOUSE.rooms;
export const ROOM_FAMILY_BY_ID: Readonly<Record<string, RoomFamily>> = Object.fromEntries(
  COMPILED_DEFAULT_HOUSE.rooms.map((room) => [room.id, room.family]),
);

export { DEFAULT_HOUSE_SCENE, deriveHouseOpenings };
export type { HouseRoomDefinition };
