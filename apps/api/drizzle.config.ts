import { defineConfig } from 'drizzle-kit';

// Migrations are generated from src/db/schema.ts into the repository-level infra/migrations folder
// and committed. `pnpm db:generate` must produce no changes in CI.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: '../../infra/migrations',
});
