/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500
  },
  test: {
    include: ['src/test/**/*.test.ts'],
    environment: 'node'
  }
});
