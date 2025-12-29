// packages/sdk/src/util/compile-settings-schema.ts

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import * as esbuild from 'esbuild'
import { complete, errored, type Result } from '../errors.js'
import { APP_SETTINGS_FILENAME } from '../constants/settings-files.js'
import { HIDDEN_AUXX_DIRECTORY } from '../constants/hidden-auxx-directory.js'

// Get the SDK package root directory (where we're running from)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// From lib/util/ → go up to package root (lib/ → packages/sdk/)
const SDK_ROOT = path.resolve(__dirname, '..', '..')

/**
 * Possible error types when compiling settings schema
 */
export type CompileSettingsSchemaError =
  | { code: 'SETTINGS_FILE_NOT_FOUND' }
  | { code: 'SETTINGS_COMPILE_FAILED'; error: Error }
  | { code: 'FAILED_TO_CREATE_OUTPUT_DIR'; error: Error }

/**
 * Compiles app.settings.ts to JavaScript for dynamic import
 *
 * TypeScript files cannot be imported directly via import() in Node.js,
 * so we compile them to JavaScript first using esbuild.
 *
 * The compiled output is cached in .auxx/app.settings.js to avoid
 * recompiling on every upload.
 *
 * @returns Result with path to compiled JS file, or undefined if source doesn't exist
 */
export async function compileSettingsSchema(): Promise<
  Result<string | undefined, CompileSettingsSchemaError>
> {
  const srcDirAbsolute = path.resolve('src')
  const settingsFilePath = path.join(srcDirAbsolute, APP_SETTINGS_FILENAME)

  // Check if source file exists
  try {
    await fs.access(settingsFilePath)
  } catch {
    // File doesn't exist - this is OK, settings are optional
    return complete(undefined)
  }

  // Create .auxx directory if it doesn't exist
  const auxxDir = path.resolve(HIDDEN_AUXX_DIRECTORY)
  try {
    await fs.mkdir(auxxDir, { recursive: true })
  } catch (error: unknown) {
    return errored({
      code: 'FAILED_TO_CREATE_OUTPUT_DIR',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  }

  // Output path in .auxx directory
  const outputPath = path.join(auxxDir, 'app.settings.js')

  // Compile TypeScript to JavaScript using esbuild
  // Bundle everything including SDK imports so the compiled file has zero external dependencies
  try {
    await esbuild.build({
      entryPoints: [settingsFilePath],
      bundle: true, // Bundle everything including SDK imports
      outfile: outputPath,
      format: 'esm',
      platform: 'node',
      target: ['node18'],
      logLevel: 'silent',
      write: true, // Write to disk for caching
      alias: {
        // Resolve @auxx/sdk to this SDK package's built files
        // This allows esbuild to find the SDK when compiling from user's app directory
        '@auxx/sdk': path.join(SDK_ROOT, 'lib', 'root', 'index.js'),
      },
    })

    return complete(outputPath)
  } catch (error: unknown) {
    return errored({
      code: 'SETTINGS_COMPILE_FAILED',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  }
}
