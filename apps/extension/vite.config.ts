// apps/extension/vite.config.ts

import { resolve } from 'node:path'
import { crx } from '@crxjs/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import manifest from './manifest.json' with { type: 'json' }

/**
 * Auxx Chrome extension build config.
 *
 * - `crx()` produces a valid MV3 build from `manifest.json`, including HMR
 *   for content scripts and the iframe React app while running `pnpm dev`.
 * - The iframe's auxx.ai base URL is resolved once at build time from env
 *   (mirrors `@auxx/config`'s `resolveAppUrl('web')`) and injected via
 *   `define`. Next.js apps rewrite a `__RUNTIME_DOMAIN__` placeholder at
 *   container boot; the extension can't do that (it ships as a signed zip)
 *   so the URL bakes in. One build per target environment.
 *
 * URL resolution order (same env story as every other app in the monorepo):
 *   1. APP_URL (explicit override)
 *   2. DOMAIN → `https://app.${DOMAIN}`
 *   3. http://localhost:${WEB_PORT || 3000}
 *
 * This logic is inlined rather than imported from `@auxx/config` to avoid
 * a build-order coupling: Vite's config loader resolves via Node's `import`
 * condition (→ `./dist/*.mjs`), which doesn't exist until tsdown builds the
 * config package. Duplicating 6 lines is worth sidestepping that race.
 */

function readEnv(key: string): string | undefined {
  const value = process.env[key]
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function resolveWebappUrl(): string {
  const appUrl = readEnv('APP_URL')
  if (appUrl) return appUrl
  const domain = readEnv('DOMAIN')
  if (domain) return `https://app.${domain}`
  const port = readEnv('WEB_PORT') ?? '3000'
  return `http://localhost:${port}`
}

export default defineConfig(({ command }) => ({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
    },
  },
  define: {
    __AUXX_WEBAPP_URL__: JSON.stringify(resolveWebappUrl()),
  },
  build: {
    outDir: 'dist',
    target: 'chrome116',
    // Source maps in dev only. The Chrome Web Store warns on shipped maps
    // and they roughly triple the zip size with no review-side benefit
    // (the store expects minified extension code).
    sourcemap: command !== 'build',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // Iframe shell — referenced from web_accessible_resources too.
        iframe: resolve(__dirname, 'src/iframe/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5174 },
    // Canonical fix from the crxjs docs — Vite 6 defaults to a strict CORS
    // allowlist that excludes chrome-extension origins, so the MV3 service
    // worker can't fetch its dev modules. This regex echoes back any
    // chrome-extension:// origin in `Access-Control-Allow-Origin`.
    cors: { origin: [/chrome-extension:\/\//] },
  },
}))
