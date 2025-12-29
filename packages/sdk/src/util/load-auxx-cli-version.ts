// packages/sdk/src/util/load-auxx-cli-version.ts

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { findUpSync } from 'find-up-simple'
import { z } from 'zod'
import { complete, errored, type CliVersionResult } from '../errors.js'

/**
 * File name used when traversing upward from the current module to locate the
 * SDK package manifest.
 */
const FILE_NAME = 'package.json'

/**
 * Zod schema enforcing that the discovered manifest belongs to `@auxx/sdk` and
 * exposes a string `version` field.
 */
const packageJsonSchema = z.object({
  name: z.literal('@auxx/sdk'),
  version: z.string({
    required_error: 'No CLI version found',
    invalid_type_error: 'CLI version must be a string in package.json',
  }),
})

/**
 * Parsed manifest shape matching `packageJsonSchema`.
 */
type PackageJson = z.infer<typeof packageJsonSchema>

/**
 * Cached manifest so repeated version lookups avoid redundant disk reads.
 */
let packageJson: PackageJson | undefined

/**
 * Resolves the Auxx CLI version by locating the nearest `@auxx/sdk`
 * `package.json`, validating its structure, and returning the version wrapped in
 * the shared `Result` type. Lookup failures return structured errors describing
 * the failure mode.
 *
 * @returns `CliVersionResult` containing either the version string or a typed error.
 *
 * @example
 * ```ts
 * const result = loadAuxxCliVersion()
 * if (result.state === 'complete') {
 *   console.log(`CLI version: ${result.value}`)
 * } else {
 *   console.error(result.error.code)
 * }
 * ```
 */
export function loadAuxxCliVersion(): CliVersionResult {
  if (packageJson === undefined) {
    const cwd = fileURLToPath(import.meta.url)
    const packageJsonPath = findUpSync(FILE_NAME, { cwd })
    if (packageJsonPath === undefined) {
      return errored({
        code: 'UNABLE_TO_FIND_PACKAGE_JSON',
        path: cwd,
      })
    }

    let contents: string
    try {
      contents = readFileSync(packageJsonPath, 'utf8')
    } catch (error) {
      return errored({
        code: 'UNABLE_TO_READ_PACKAGE_JSON',
        error,
      })
    }

    let json: unknown
    try {
      json = JSON.parse(contents)
    } catch (error) {
      return errored({
        code: 'UNABLE_TO_PARSE_PACKAGE_JSON',
        error,
      })
    }

    const result = packageJsonSchema.safeParse(json)
    if (!result.success) {
      return errored({
        code: 'INVALID_PACKAGE_JSON',
        error: result.error,
      })
    }

    packageJson = result.data
  }

  const { version } = packageJson
  if (!version) {
    return errored({
      code: 'NO_CLI_VERSION_FOUND',
    })
  }

  return complete(version)
}

