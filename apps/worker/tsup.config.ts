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
  treeshake: true,
  splitting: true, // Enable code splitting to avoid one big file
  platform: 'node',

  // Bundle everything
  skipNodeModulesBundle: false,

  // Force workspace packages to be bundled
  noExternal: [
    /^@auxx\//,  // All @auxx/* packages
  ],

  // Keep these external
  external: [
    // Native binary modules (can't be bundled)
    'sharp',
    'canvas',
    'pg-native',
    'isolated-vm',
    'esbuild',
    '@mapbox/node-pre-gyp',
    'bcrypt',

    // Core runtime dependencies
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
