import { defineConfig } from 'vite';

const roomServerTarget = 'http://127.0.0.1:5191';

export default defineConfig(({ mode }) => ({
  esbuild: mode === 'harmony-release'
    ? { drop: ['console', 'debugger'] }
    : undefined,
  server: {
    host: '0.0.0.0',
    port: 5189,
    strictPort: true,
    proxy: {
      '/healthz': roomServerTarget,
      '/socket.io': {
        target: roomServerTarget,
        ws: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4189,
    strictPort: true,
    proxy: {
      '/healthz': roomServerTarget,
      '/socket.io': {
        target: roomServerTarget,
        ws: true,
      },
    },
  },
  build: {
    sourcemap: mode !== 'harmony-release',
    minify: mode === 'harmony-release' ? 'esbuild' : undefined,
    chunkSizeWarningLimit: 700,
  },
}));
