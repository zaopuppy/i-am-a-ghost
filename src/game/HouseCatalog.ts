import ringHouseSource from '../../assets/maps/ring-old-house.scene.json' with { type: 'json' };
import { COMPILED_DEFAULT_HOUSE } from './defaultHouse';
import { compileHouseScene, isHouseSceneDefinition, type CompiledHouseScene } from './HouseScene';

const ringSource: unknown = ringHouseSource;
if (!isHouseSceneDefinition(ringSource)) throw new Error('Ring house scene is malformed.');
const ringHouse = compileHouseScene(ringSource);
const ringErrors = ringHouse.issues.filter((issue) => issue.severity === 'error');
if (ringErrors.length) throw new Error(`Ring house scene is invalid: ${ringErrors.map((issue) => issue.message).join(' ')}`);

export const HOUSES = {
  'm3-nine-room-house': { name: '九房宅邸', hint: '熟悉的九房布局，穿过门厅寻找出路。', scene: COMPILED_DEFAULT_HOUSE },
  'ring-old-house': { name: '回廊旧宅', hint: '沿环形通路绕行，留意中庭两侧的入口。', scene: ringHouse },
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
