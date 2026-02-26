// packages/deployment/tsdown.config.ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/client.ts'],
  format: 'esm',
  target: 'es2022',
  platform: 'node',
  unbundle: true,
  dts: false,
  tsconfig: 'tsconfig.build.json',
})
