import { defineConfig } from 'vite';

const roomServerTarget = 'http://127.0.0.1:5191';

export default defineConfig(({ mode }) => ({
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
    chunkSizeWarningLimit: 700,
  },
}));
