import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 5180 belongs to apps/pds — both apps must be runnable side by side.
    port: 5181,
    open: false,
  },
  test: {
    // marker/, nest/ and canvas/collision/ are pure modules — they must stay
    // unit-testable without a DOM. Anything needing one declares it per file.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
