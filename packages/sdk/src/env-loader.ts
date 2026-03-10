// packages/sdk/src/env-loader.ts
// Must be imported before any other modules to ensure .env
// variables are available when env.ts constants are evaluated.

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import dotenv from 'dotenv'

/**
 * Walks up from cwd to find the nearest .env file.
 * This allows apps nested in a monorepo to inherit the root .env.
 */
function findEnvFile(): string | undefined {
  let dir = resolve(process.cwd())
  const root = dirname(dir) === dir ? dir : '/'

  while (true) {
    const candidate = join(dir, '.env')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir || dir === root) break
    dir = parent
  }

  return undefined
}

dotenv.config({ path: findEnvFile() })
