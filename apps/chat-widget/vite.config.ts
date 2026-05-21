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
 * URL resolution order (matches every other app):
 *   1. APP_URL (explicit override)
 *   2. DOMAIN → `https://app.${DOMAIN}`
 *   3. http://localhost:${WEB_PORT || 3000}
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
    __AUXX_API_BASE_URL__: JSON.stringify(resolveWebappUrl()),
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
