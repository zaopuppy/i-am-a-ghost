import ringHouseSource from '../../assets/maps/ring-old-house.scene.json' with { type: 'json' };
import castleHouseSource from '../../assets/maps/midnight-castle.scene.json' with { type: 'json' };
import { COMPILED_DEFAULT_HOUSE } from './defaultHouse';
import { compileHouseScene, isHouseSceneDefinition, type CompiledHouseScene } from './HouseScene';

const ringSource: unknown = ringHouseSource;
if (!isHouseSceneDefinition(ringSource)) throw new Error('Ring house scene is malformed.');
const ringHouse = compileHouseScene(ringSource);
const ringErrors = ringHouse.issues.filter((issue) => issue.severity === 'error');
if (ringErrors.length) throw new Error(`Ring house scene is invalid: ${ringErrors.map((issue) => issue.message).join(' ')}`);
const castleSource: unknown = castleHouseSource;
if (!isHouseSceneDefinition(castleSource)) throw new Error('Castle house scene is malformed.');
const castleHouse = compileHouseScene(castleSource);
const castleErrors = castleHouse.issues.filter((issue) => issue.severity === 'error');
if (castleErrors.length) throw new Error(`Castle house scene is invalid: ${castleErrors.map((issue) => issue.message).join(' ')}`);

export const HOUSES = {
  'm3-nine-room-house': { name: '九房宅邸', hint: '熟悉的九房布局，穿过门厅寻找出路。', scene: COMPILED_DEFAULT_HOUSE },
  'ring-old-house': { name: '回廊旧宅', hint: '沿环形通路绕行，留意中庭两侧的入口。', scene: ringHouse },
  'midnight-castle': { name: '午夜契约古堡', hint: '穿过石拱门与双环回廊，在午夜契约下寻找伙伴。', scene: castleHouse },
} as const;

export type HouseId = keyof typeof HOUSES;
export const DEFAULT_HOUSE_ID: HouseId = 'm3-nine-room-house';
export const HOUSE_IDS = Object.keys(HOUSES) as HouseId[];

export function isHouseId(value: unknown): value is HouseId {
  return typeof value === 'string' && Object.hasOwn(HOUSES, value);
}

export function houseScene(id: HouseId): CompiledHouseScene {
  return HOUSES[id].scene;
}

/** Edited geometry must use the procedural preview instead of stale Blender meshes. */
export function usesAuthoredCastleEnvironment(house: CompiledHouseScene): boolean {
  if (house.definition.id !== 'midnight-castle') return false;
  const geometry = (scene: CompiledHouseScene) => ({
    bounds: scene.definition.bounds,
    rooms: scene.definition.rooms,
    walls: scene.definition.walls,
    furniture: scene.definition.furniture,
  });
  return JSON.stringify(geometry(house)) === JSON.stringify(geometry(castleHouse));
}
