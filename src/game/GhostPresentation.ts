export const GHOST_FADE_SECONDS = 0.25;

export function ghostFadeOpacity(hiddenForSeconds: number): number | null {
  if (hiddenForSeconds < 0) return 1;
  if (hiddenForSeconds >= GHOST_FADE_SECONDS) return null;
  return 1 - hiddenForSeconds / GHOST_FADE_SECONDS;
}
