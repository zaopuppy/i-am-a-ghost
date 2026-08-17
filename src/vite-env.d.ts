/// <reference types="vite/client" />

import type { ViewerFrame } from './game/ViewerFrame';
import type { RuntimeTuning } from './game/RuntimeTuning';

interface GhostGameDiagnostics {
  phase: 'lobby' | 'playing' | 'ended';
  matchPhase: ViewerFrame['phase'] | null;
  deterministicState: string | null;
  frame: number;
  fps: number;
  networkConnected: boolean;
  roomCode: string | null;
  role: 'ghost' | 'child' | null;
  serverTick: number | null;
  ackSeq: number | null;
  ownPosition: { x: number; z: number } | null;
  viewerFrame: ViewerFrame | null;
  cameraMode: 'follow' | 'whole-house' | 'capture-closeup';
  cameraViewHeight: number;
  capturedChildPlayerId: string | null;
  tuning: RuntimeTuning;
  world: {
    actors: number;
    walls: number;
    rooms: number;
    beams: number;
    visibleObjects: number;
    materials: number;
    animatedActors: number;
    assets: {
      kid: {
        status: 'not-requested' | 'loading' | 'ready' | 'failed';
        fileBytes: number;
        triangles: number;
        meshes: number;
        materials: number;
        textures: number;
        clips: string[];
      };
      wall: {
        status: 'not-requested' | 'loading' | 'ready' | 'failed';
        fileBytes: number;
        triangles: number;
        meshes: number;
        materials: number;
        textures: number;
        clips: string[];
      };
    };
  };
  audio: {
    unlocked: boolean;
    muted: boolean;
    loaded: number;
    failed: number;
  };
  input: {
    actionHeld: boolean;
  };
  network: {
    pendingInputs: number;
    lastAckLatencyMs: number | null;
    frameAgeMs: number | null;
    reconnecting: boolean;
    corrections: number;
    hardSnaps: number;
    interpolationAlpha: number;
    bufferedFrames: number;
    bufferLeadMs: number;
    bufferUnderruns: number;
  };
  renderer: {
    calls: number;
    triangles: number;
    points: number;
    lines: number;
    geometries: number;
    textures: number;
  };
}

declare global {
  interface Window {
    __THREE_GAME_DIAGNOSTICS__?: GhostGameDiagnostics;
    __THREE_GAME_TEST_HOOKS__?: {
      seed(value: number): void;
      setState(name: string): void;
      setPausedForScreenshot(paused: boolean): void;
      setReducedMotion(enabled: boolean): void;
      hideDebugUi(hidden: boolean): void;
      hideOverlay(hidden: boolean): void;
    };
  }
}

export {};
