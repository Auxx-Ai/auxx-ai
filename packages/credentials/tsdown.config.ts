// packages/credentials/tsdown.config.ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/api-key/index.ts',
    'src/passport/index.ts',
    'src/manager/index.ts',
    'src/service/index.ts',
    'src/types/index.ts',
    'src/login-token/index.ts',
    'src/config/index.ts',
    'src/config/client.ts',
  ],
  format: 'esm',
  target: 'es2022',
  platform: 'node',
  unbundle: true,
  dts: false,
  tsconfig: 'tsconfig.build.json',
  external: ['sst', 'aws4fetch'],
})
