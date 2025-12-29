// packages/sdk/src/util/extract-settings-schema.ts

import { pathToFileURL } from 'url'
import { complete, errored, isErrored, type Result } from '../errors.js'
import { compileSettingsSchema } from './compile-settings-schema.js'

/**
 * Settings schema structure with organization and user scopes
 */
export type SettingsSchema = {
  organization?: Record<string, unknown>
  user?: Record<string, unknown>
}

/**
 * Possible error types when extracting settings schema
 */
export type ExtractSettingsSchemaError =
  | { code: 'SETTINGS_FILE_NOT_FOUND' }
  | { code: 'SETTINGS_COMPILE_FAILED'; error: Error }
  | { code: 'SETTINGS_IMPORT_FAILED'; error: Error }
  | { code: 'SETTINGS_SCHEMA_INVALID'; message: string }

/**
 * Extract settings schema from app.settings.ts file
 * Returns the schema object or undefined if file doesn't exist
 *
 * Compiles TypeScript to JavaScript first since Node.js cannot import .ts files directly
 *
 * @returns Result with schema object or undefined (if file missing), or error
 */
export async function extractSettingsSchema(): Promise<
  Result<SettingsSchema | undefined, ExtractSettingsSchemaError>
> {
  // Compile TypeScript to JavaScript
  const compileResult = await compileSettingsSchema()
  if (isErrored(compileResult)) {
    // Map compile errors to extract errors
    const error = compileResult.error
    if (error.code === 'SETTINGS_COMPILE_FAILED') {
      return errored({
        code: 'SETTINGS_COMPILE_FAILED',
        error: error.error,
      })
    }
    // Other compile errors shouldn't happen, but handle gracefully
    return errored({
      code: 'SETTINGS_COMPILE_FAILED',
      error: new Error(`Unexpected compile error: ${error.code}`),
    })
  }

  const compiledPath = compileResult.value

  // If no compiled file, settings don't exist (optional)
  if (!compiledPath) {
    return complete(undefined)
  }

  // Import the compiled JavaScript file
  try {
    // Convert to file:// URL for dynamic import
    const fileUrl = pathToFileURL(compiledPath).href

    // Add cache-busting query parameter to force fresh import
    const module = await import(`${fileUrl}?t=${Date.now()}`)

    // Get default export (appSettingsSchema)
    const schema = module.default

    if (!schema) {
      return errored({
        code: 'SETTINGS_SCHEMA_INVALID',
        message: 'app.settings.ts must export default schema',
      })
    }

    // Validate structure
    if (typeof schema !== 'object') {
      return errored({
        code: 'SETTINGS_SCHEMA_INVALID',
        message: 'Settings schema must be an object',
      })
    }

    // Ensure it has organization or user keys
    if (!schema.organization && !schema.user) {
      return errored({
        code: 'SETTINGS_SCHEMA_INVALID',
        message: 'Settings schema must have organization or user keys',
      })
    }

    return complete(schema as SettingsSchema)
  } catch (error: unknown) {
    return errored({
      code: 'SETTINGS_IMPORT_FAILED',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  }
}
