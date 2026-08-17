/// <reference types="vite/client" />

import type { ViewerFrame } from './game/ViewerFrame';

interface GhostGameDiagnostics {
  phase: 'lobby' | 'playing' | 'ended';
  frame: number;
  fps: number;
  networkConnected: boolean;
  roomCode: string | null;
  role: 'ghost' | 'child' | null;
  serverTick: number | null;
  ackSeq: number | null;
  ownPosition: { x: number; z: number } | null;
  viewerFrame: ViewerFrame | null;
  cameraMode: 'follow' | 'whole-house';
  world: {
    actors: number;
    walls: number;
    rooms: number;
    beams: number;
  };
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
}

declare global {
  interface Window {
    __THREE_GAME_DIAGNOSTICS__?: GhostGameDiagnostics;
    __THREE_GAME_TEST_HOOKS__?: {
      hideOverlay(hidden: boolean): void;
    };
  }
}

export {};
