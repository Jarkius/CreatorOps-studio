import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'dist/**', 'e2e/**'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
