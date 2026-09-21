export const CHARACTER_MODELS = {
  kid: {
    rogue: { name: '游侠', file: 'kaykit-adventurers/Rogue_Kid.glb', bytes: 503_252, height: 1.5, yaw: Math.PI / 2 },
    scout: { name: '夜行童子', file: 'original/Night_Scout.glb', bytes: 153_564, height: 1.5, yaw: 0 },
  },
  ghost: {
    specter: { name: '幽灵', file: 'kaykit-adventurers/Ghost.glb', bytes: 445_612, height: 1.72, yaw: Math.PI / 2 },
    wraith: { name: '旧宅怨灵', file: 'original/Old_House_Wraith.glb', bytes: 108_308, height: 1.72, yaw: 0 },
  },
} as const;

export type CharacterKind = keyof typeof CHARACTER_MODELS;
export type KidModelId = keyof typeof CHARACTER_MODELS.kid;
export type GhostModelId = keyof typeof CHARACTER_MODELS.ghost;
export type CharacterModelId = KidModelId | GhostModelId;
export const DEFAULT_KID_MODEL: KidModelId = 'rogue';
export const DEFAULT_GHOST_MODEL: GhostModelId = 'specter';

export function modelKind(id: unknown): CharacterKind | null {
  if (typeof id !== 'string') return null;
  if (Object.hasOwn(CHARACTER_MODELS.kid, id)) return 'kid';
  if (Object.hasOwn(CHARACTER_MODELS.ghost, id)) return 'ghost';
  return null;
}

export function defaultModelForRole(role: 'child' | 'ghost'): CharacterModelId {
  return role === 'ghost' ? DEFAULT_GHOST_MODEL : DEFAULT_KID_MODEL;
}
