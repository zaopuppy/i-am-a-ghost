export function chooseNextGhost(
  orderedPlayerIds: readonly string[],
  previousGhostPlayerId: string | null,
  firstRoundRandomIndex: number,
): string {
  if (orderedPlayerIds.length < 1) throw new RangeError('Cannot choose a ghost from an empty roster.');
  const previousIndex = previousGhostPlayerId
    ? orderedPlayerIds.indexOf(previousGhostPlayerId)
    : -1;
  if (previousIndex >= 0) return orderedPlayerIds[(previousIndex + 1) % orderedPlayerIds.length];
  const normalizedIndex = Math.max(0, Math.min(orderedPlayerIds.length - 1, firstRoundRandomIndex));
  return orderedPlayerIds[normalizedIndex];
}
