// packages/types/tsdown.config.ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'index.ts',
    'actor/index.ts',
    'custom-field/index.ts',
    'field/index.ts',
    'field-value/index.ts',
    'groups/index.ts',
    'pagination/index.ts',
    'resource/index.ts',
    'task/index.ts',
    'draft/index.ts',
    'signature/index.ts',
    'config/index.ts',
    'billing/index.ts',
  ],
  format: 'esm',
  target: 'es2022',
  platform: 'node',
  unbundle: true,
  dts: false,
  tsconfig: 'tsconfig.build.json',
})
