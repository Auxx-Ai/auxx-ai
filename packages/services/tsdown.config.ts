// packages/services/tsdown.config.ts
import { readdirSync, statSync } from 'node:fs'
import { defineConfig } from 'tsdown'

// Auto-discover all src/*/index.ts entries
const modules = readdirSync('src', { withFileTypes: true })
  .filter((d) => d.isDirectory() && statSync(`src/${d.name}/index.ts`, { throwIfNoEntry: false }))
  .map((d) => `src/${d.name}/index.ts`)
  .sort()

export default defineConfig({
  entry: ['src/index.ts', 'src/app-settings/client.ts', 'src/shared/utils.ts', ...modules],
  format: 'esm',
  target: 'es2022',
  platform: 'node',
  unbundle: true,
  dts: false,
  tsconfig: 'tsconfig.build.json',
})
