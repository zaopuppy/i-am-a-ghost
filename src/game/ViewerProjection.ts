import { MATCH_RULES, type MatchCheckpoint } from './MatchEngine';
import type {
  ChildViewerFrame,
  GhostViewerFrame,
  SharedMatchFrame,
  ViewerFrame,
  VisibleChild,
  VisibleGhost,
} from './ViewerFrame';

export interface ViewerProjectionOptions {
  activeFlashlightPlayerIds?: ReadonlySet<string>;
}

export function projectViewerFrame(
  checkpoint: MatchCheckpoint,
  viewerPlayerId: string,
  options: ViewerProjectionOptions = {},
): ViewerFrame {
  const viewer = checkpoint.players.find((player) => player.id === viewerPlayerId);
  if (!viewer) throw new Error(`Unknown frame viewer: ${viewerPlayerId}`);

  const shared: SharedMatchFrame = {
    tick: checkpoint.tick,
    phase: checkpoint.phase,
    winner: checkpoint.winner,
    remainingTicks: checkpoint.remainingTicks,
    captureCount: checkpoint.captureCount,
    ghostHealth: checkpoint.ghostHealth,
    capture: checkpoint.phase === 'capture-animation' && checkpoint.capturedChildPlayerId
      ? {
          childPlayerId: checkpoint.capturedChildPlayerId,
          ticksRemaining: checkpoint.phaseTicksRemaining,
          durationTicks: MATCH_RULES.captureAnimationTicks,
        }
      : null,
  };
  const children: VisibleChild[] = checkpoint.players
    .filter((player) => player.role === 'child' && player.active)
    .map((child) => ({
      playerId: child.id,
      slot: child.slot ?? 0,
      position: { ...child.position },
      facingRadians: child.facingRadians,
      headlamp: child.headlamp ?? 'off',
      flashlightOn: options.activeFlashlightPlayerIds?.has(child.id) ?? false,
      batteryCharge: child.battery ?? 0,
    }));
  const dolls = [
    ...checkpoint.dolls.map((doll) => ({
      dollId: doll.id,
      slot: doll.slot,
      position: { ...doll.position },
      headlamp: doll.headlamp,
    })),
    ...checkpoint.players
      .filter((player) => player.role === 'child' && !player.active)
      .map((player) => ({
        dollId: `disconnected-${player.id}`,
        slot: player.slot ?? 0,
        position: { ...player.position },
        headlamp: player.headlamp ?? 'off',
      })),
  ];
  const ghostPlayer = checkpoint.players.find((player) => player.role === 'ghost');
  if (!ghostPlayer) throw new Error('Checkpoint is missing its ghost player.');
  const ghost: VisibleGhost = {
    position: { ...ghostPlayer.position },
    facingRadians: ghostPlayer.facingRadians,
    burning: checkpoint.ghostBurnTicksRemaining > 0,
    burnTicksRemaining: checkpoint.ghostBurnTicksRemaining,
  };
  const batteries = checkpoint.batteries.map((battery) => ({
    batteryId: battery.id,
    position: { ...battery.position },
  }));
  const battery = batteries[0] ?? null;

  if (viewer.role === 'ghost') {
    const frame: GhostViewerFrame = {
      ...shared,
      viewerRole: 'ghost',
      viewerPlayerId,
      ghost,
      children,
      dolls,
      batteries,
      battery,
    };
    return frame;
  }

  if (!viewer.active) throw new Error('An inactive child cannot receive a viewer frame.');

  const frame: ChildViewerFrame = {
    ...shared,
    viewerRole: 'child',
    viewerPlayerId,
    ownBattery: viewer.battery ?? 0,
    children,
    dolls,
    batteries,
    ...(checkpoint.ghostRevealed
      || checkpoint.ghostBurnTicksRemaining > 0
      || checkpoint.capturedChildPlayerId === viewerPlayerId
      ? { ghost }
      : {}),
    ...(battery ? { battery } : {}),
  };
  return frame;
}
