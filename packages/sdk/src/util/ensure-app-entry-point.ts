// packages/sdk/src/util/ensure-app-entry-point.ts

import path from 'path'
import readline from 'readline/promises'
import { complete, errored, isErrored, type Result } from '../errors.js'
import { generateAppEntryPoint } from './generate-app-entry-point.js'
import { getAppEntryPoint } from './get-app-entry-point.js'

/**
 * Ensures the application entry point exists by checking for `app.ts`/`app.tsx`
 * inside the project `src` directory. When `promptToGenerate` is true, the
 * caller is prompted to generate a new entry point if one is missing.
 *
 * @param promptToGenerate When true, prompts the user to generate the entry point on demand.
 * @returns `Result<boolean, { code: 'APP_ENTRY_POINT_NOT_FOUND' | 'FAILED_TO_GENERATE_ENTRY_POINT' }>`
 * indicating success or a typed failure.
 *
 * @example
 * ```ts
 * const result = await ensureAppEntryPoint(true)
 * if (result.state === 'complete') {
 *   console.log('Entry point ready')
 * } else {
 *   console.error(result.error.code)
 * }
 * ```
 */
export async function ensureAppEntryPoint(
  promptToGenerate = false
): Promise<
  Result<
    boolean,
    { code: 'APP_ENTRY_POINT_NOT_FOUND' } | { code: 'FAILED_TO_GENERATE_ENTRY_POINT' }
  >
> {
  const srcDirAbsolute = path.resolve('src')
  const appEntryPoint = await getAppEntryPoint(srcDirAbsolute)
  if (appEntryPoint !== null) {
    return complete(true)
  }
  if (!promptToGenerate) {
    return errored({
      code: 'APP_ENTRY_POINT_NOT_FOUND',
    })
  }
  const readlineInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  await readlineInterface.question(
    'Could not find app.ts entry point. Press Enter to generate it....'
  )
  readlineInterface.close()
  const generateResult = await generateAppEntryPoint(srcDirAbsolute)
  if (isErrored(generateResult)) {
    return errored({
      code: 'FAILED_TO_GENERATE_ENTRY_POINT',
    })
  }
  return complete(true)
}
