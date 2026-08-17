import type { HeadlampBand, Vec2 } from './MatchEngine';

export interface SharedMatchFrame {
  tick: number;
  phase: 'playing' | 'capture-animation' | 'protection' | 'ended';
  winner: 'children' | 'ghost' | null;
  remainingTicks: number;
  captureCount: number;
  ghostHealth: number;
}

export interface VisibleChild {
  playerId: string;
  slot: number;
  position: Vec2;
  facingRadians: number;
  headlamp: HeadlampBand;
  flashlightOn: boolean;
}

export interface VisibleDoll {
  dollId: string;
  slot: number;
  position: Vec2;
  headlamp: HeadlampBand;
}

export interface VisibleGhost {
  position: Vec2;
  facingRadians: number;
  captureState: 'idle' | 'windup' | 'cooldown';
}

export interface VisibleBattery {
  batteryId: string;
  position: Vec2;
}

export interface GhostViewerFrame extends SharedMatchFrame {
  viewerRole: 'ghost';
  viewerPlayerId: string;
  ghost: VisibleGhost;
  children: VisibleChild[];
  dolls: VisibleDoll[];
  battery: VisibleBattery | null;
}

export interface ChildViewerFrame extends SharedMatchFrame {
  viewerRole: 'child';
  viewerPlayerId: string;
  ownBattery: number;
  children: VisibleChild[];
  dolls: VisibleDoll[];
  ghost?: VisibleGhost;
  battery?: VisibleBattery;
}

export type ViewerFrame = GhostViewerFrame | ChildViewerFrame;
