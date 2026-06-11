// // packages/sdk/src/commands/build/validate-typescript.ts

import chalk from 'chalk'
import path from 'path'
import type { default as ts } from 'typescript'
import { complete, errored, isErrored } from '../../errors.js'
import { ensureAppFieldsTypes } from '../../util/ensure-app-fields-types.js'
import { generateAppEnvTypes } from '../../util/generate-app-env-types.js'
import { hardExit } from '../../util/hard-exit.js'
import { spinnerify } from '../../util/spinner.js'
import {
  getDiagnostics,
  printTsError,
  readConfig,
  typeScriptErrorSchema,
} from '../../util/typescript.js'

export async function validateTypeScript() {
  try {
    const program = await readConfig(path.resolve('tsconfig.json'))
    if (program === 'Not a TypeScript project') {
      return complete(true)
    }
    const pro = program as ts.Program
    const errors = await getDiagnostics(pro)
    if (errors.length) {
      return errored({ code: 'VALIDATE_TYPE_SCRIPT_ERROR', errors })
    }
    return complete(true)
  } catch (error) {
    if (error instanceof Error) {
      const tsError = typeScriptErrorSchema.parse({ text: error.message })
      return errored({ code: 'VALIDATE_TYPE_SCRIPT_ERROR', errors: [tsError] })
    }
    return errored({ code: 'FILE_SYSTEM_ERROR', error })
  }
}

/**
 * Generate supporting type files, run the TypeScript program, print
 * diagnostics, and exit the process on failure. Shared by `auxx build`
 * and `auxx version create`.
 */
export async function validateTypeScriptOrExit() {
  const appEnvTypesResult = await generateAppEnvTypes()
  if (isErrored(appEnvTypesResult)) {
    process.stderr.write(
      chalk.yellow(
        `⚠ Could not generate src/auxx-env.d.ts at ${appEnvTypesResult.error.path}. TypeScript image imports may show warnings.\n`
      )
    )
  } else if (appEnvTypesResult.value === 'skipped_unmanaged') {
    process.stderr.write(
      chalk.yellow(
        '⚠ Skipping src/auxx-env.d.ts generation because the existing file is unmanaged.\n'
      )
    )
  }

  // Layer 2 — narrow value-I/O signatures to this app's declared fields.
  await ensureAppFieldsTypes()

  const tsResult = await spinnerify(
    'Validating TypeScript...',
    'TypeScript validation passed',
    validateTypeScript
  )

  if (isErrored(tsResult)) {
    if (tsResult.error.code === 'VALIDATE_TYPE_SCRIPT_ERROR') {
      process.stdout.write('\n')
      process.stderr.write(
        chalk.red(`✖ Found ${tsResult.error.errors.length} TypeScript error(s):\n`)
      )

      // Print first 10 errors
      const errorsToShow = tsResult.error.errors.slice(0, 10)
      for (const error of errorsToShow) {
        printTsError(error)
      }

      if (tsResult.error.errors.length > 10) {
        process.stderr.write(
          chalk.yellow(`\n  ... and ${tsResult.error.errors.length - 10} more error(s)\n`)
        )
      }

      process.exit(1)
    }

    hardExit(`TypeScript validation failed: ${tsResult.error.error}`)
  }
}
