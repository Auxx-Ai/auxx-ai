// apps/chat-widget/vite.config.ts

import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/**
 * Auxx chat-widget bundle build config.
 *
 * Mirrors `apps/extension` — one self-contained IIFE bundle per env, with the
 * api base URL baked in via `define`. Preact replaces React via the
 * `preact/compat` alias so existing `React.createElement`/JSX code keeps
 * working at a fraction of the bundle weight.
 *
 * The bundle talks only to `apps/api` (Hono) — config, passport, and the
 * full chat surface all live there. URL resolution mirrors `@auxx/config`'s
 * `resolveAppUrl('api')`:
 *   1. API_URL (explicit override)
 *   2. DOMAIN → `https://api.${DOMAIN}`
 *   3. http://localhost:${API_PORT || 3007}
 *
 * Inlined rather than imported from `@auxx/config` for the same reason
 * `apps/extension` inlines: Vite's config loader resolves via Node's
 * `import` condition, which doesn't exist until tsdown builds the config
 * package — duplicating six lines sidesteps the build-order race.
 */

function readEnv(key: string): string | undefined {
  const value = process.env[key]
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function resolveApiUrl(): string {
  const apiUrl = readEnv('API_URL')
  if (apiUrl) return apiUrl
  const domain = readEnv('DOMAIN')
  if (domain) return `https://api.${domain}`
  const port = readEnv('API_PORT') ?? '3007'
  return `http://localhost:${port}`
}

export default defineConfig({
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
      '~': resolve(__dirname, 'src'),
    },
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  define: {
    __AUXX_API_BASE_URL__: JSON.stringify(resolveApiUrl()),
  },
  build: {
    outDir: 'dist',
    lib: {
      entry: resolve(__dirname, 'src/main.tsx'),
      formats: ['iife'],
      name: 'AuxxChatWidget',
      fileName: () => 'chat-widget.js',
    },
    minify: 'esbuild',
    sourcemap: false,
    emptyOutDir: true,
    cssCodeSplit: false,
  },
})
