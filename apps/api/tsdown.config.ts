// apps/api/tsdown.config.ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'es2022',
  platform: 'node',
  // Bundle app source into single output file (like current esbuild behavior).
  // node_modules are external by default in tsdown.
  unbundle: false,
  dts: false,
  clean: true,

  // Native/binary modules that must stay external
  external: [
    'sharp',
    'canvas',
    'pg-native',
    'isolated-vm',
    'esbuild',
    '@mapbox/node-pre-gyp',
    'bcrypt',
  ],
})
