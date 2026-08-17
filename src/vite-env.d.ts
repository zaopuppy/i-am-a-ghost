/// <reference types="vite/client" />

interface GhostGameDiagnostics {
  phase: 'foundation';
  frame: number;
  fps: number;
  networkConnected: boolean;
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: GhostGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: {
    hideOverlay(hidden: boolean): void;
  };
}
