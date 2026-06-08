import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// During `vite dev`, proxy API + go2rtc signaling to the Fastify backend.
const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/go2rtc': { target: BACKEND, changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
