import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    // Builds the template database from the committed migrations once per run (D-026).
    globalSetup: ['./src/test/global-setup.ts'],
  },
});
