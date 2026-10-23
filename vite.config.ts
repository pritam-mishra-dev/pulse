import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig(({ mode }) => ({
  // CRXJS builds standalone content scripts in a production-env sub-build, so
  // import.meta.env.DEV can't distinguish dev from prod there.
  define: { __PULSE_DEV__: JSON.stringify(mode !== 'production') },
  plugins: [
    crx({
      manifest,
      // One self-contained IIFE. CRXJS's default loader dynamic-imports a
      // chrome-extension:// URL, which logs "Unsafe attempt to load URL"
      // errors in YouTube's console.
      contentScripts: { standaloneFiles: ['src/content/index.ts'] },
    }),
  ],
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  build: { target: 'chrome121', sourcemap: false, emptyOutDir: true },
  server: { port: 5174, strictPort: true, hmr: { port: 5174 }, cors: { origin: [/chrome-extension:\/\//] } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
}) as import('vite').UserConfig & { test?: unknown });
