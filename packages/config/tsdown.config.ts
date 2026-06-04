// packages/config/tsdown.config.ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/client.ts', 'src/server.ts', 'src/build.ts', 'src/urls.ts'],
  format: 'esm',
  target: 'es2022',
  platform: 'node',
  unbundle: true,
  dts: false,
  tsconfig: 'tsconfig.build.json',
})
