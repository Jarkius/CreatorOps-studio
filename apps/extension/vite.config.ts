import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { buildManifest } from './src/manifest.ts';

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as {
  version: string;
};
const devKey = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'dev-extension-key.json'), 'utf8'),
) as { key: string };

/** Writes manifest.json into the build output from the typed builder (D-029). */
function manifestPlugin(
  apiBaseUrl: string,
  includeDevKey: boolean,
  grantMetaAiForTests: boolean,
): Plugin {
  return {
    name: 'creatorops-manifest',
    generateBundle() {
      const manifest = buildManifest({
        apiBaseUrl,
        version: pkg.version,
        key: includeDevKey ? devKey.key : undefined,
        grantMetaAiForTests,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const apiBaseUrl = process.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
  return {
    // `--mode store` builds without the development key; the store assigns its own id (Q-006).
    plugins: [
      react(),
      tailwindcss(),
      manifestPlugin(apiBaseUrl, mode !== 'store', process.env.E2E_GRANT_META_AI === '1'),
    ],
    build: {
      // The end-to-end build goes to its own folder so it never replaces the real build.
      outDir: process.env.E2E_GRANT_META_AI === '1' ? 'dist-e2e' : 'dist',
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        input: {
          sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
          sw: resolve(import.meta.dirname, 'src/background/sw.ts'),
        },
        output: {
          // The manifest refers to the worker as sw.js, so it must not be hashed.
          entryFileNames: (chunk: { name: string }) =>
            chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js',
        },
      },
    },
  };
});
