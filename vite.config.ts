/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
  test: { root: '.', include: ['tests/**/*.test.ts'], environment: 'node' },
});
