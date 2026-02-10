// apps/worker/tsup.config.ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server.ts'],
  outDir: 'dist',
  target: 'esnext',
  format: ['esm'],
  clean: true,
  dts: false,
  sourcemap: false,
  treeshake: false,
  splitting: false,
  platform: 'node',

  // Don't bundle node_modules — pnpm deploy handles runtime deps
  skipNodeModulesBundle: true,

  // Keep native/binary modules external as a safety net
  external: [
    'sharp',
    'canvas',
    'pg-native',
    'isolated-vm',
    'esbuild',
    '@mapbox/node-pre-gyp',
    'bcrypt',
    'bullmq',
    'ioredis',
    'pg',
  ],

  esbuildOptions(options) {
    // Preserve dynamic requires for Node.js built-ins
    options.banner = {
      js: `import { createRequire } from 'module';const require = createRequire(import.meta.url);`,
    }
  },
})
