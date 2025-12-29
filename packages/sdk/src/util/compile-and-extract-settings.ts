// packages/sdk/src/util/compile-and-extract-settings.ts

import { pathToFileURL } from 'url'
import { isErrored } from '../errors.js'
import { compileSettingsSchema } from './compile-settings-schema.js'
import { type SettingsSchema } from './extract-settings-schema.js'
import { USE_SETTINGS } from '../env.js'

/**
 * Compiles and extracts the settings schema from app.settings.ts
 *
 * This is a simplified version of extractSettingsSchema() intended for use
 * by bundlers during the build process. It handles all errors gracefully
 * by returning undefined rather than detailed error information.
 *
 * Process:
 * 1. Check if USE_SETTINGS is enabled
 * 2. Compile app.settings.ts to JavaScript
 * 3. Import the compiled module
 * 4. Extract and validate the schema
 * 5. Return schema or undefined
 *
 * @returns The settings schema if available and valid, otherwise undefined
 *
 * @example
 * ```typescript
 * // In a bundler after successful build
 * const schema = await compileAndExtractSettingsSchema()
 * if (schema) {
 *   console.log('Settings schema extracted:', schema)
 * }
 * ```
 */
export async function compileAndExtractSettingsSchema(): Promise<SettingsSchema | undefined> {
  // Return early if settings are disabled
  if (!USE_SETTINGS) {
    return undefined
  }

  // Compile TypeScript to JavaScript
  const compileResult = await compileSettingsSchema()
  if (isErrored(compileResult) || !compileResult.value) {
    // Silently return undefined - errors will be logged by caller if needed
    return undefined
  }

  // Import the compiled JavaScript module
  try {
    const fileUrl = pathToFileURL(compileResult.value).href
    // Add cache-busting query parameter to force fresh import
    const module = await import(`${fileUrl}?t=${Date.now()}`)

    // Get default export (appSettingsSchema)
    const schema = module.default

    // Validate schema structure
    if (schema && typeof schema === 'object' && (schema.organization || schema.user)) {
      return schema as SettingsSchema
    }

    // Schema is invalid or missing
    return undefined
  } catch (error) {
    // Import or validation failed - return undefined
    // Errors will be logged by caller if needed
    return undefined
  }
}
