/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: {
    // the embedded preview browser caches modules too aggressively
    headers: { 'Cache-Control': 'no-store' }
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500
  },
  test: {
    include: ['src/test/**/*.test.ts'],
    environment: 'node'
  }
});
