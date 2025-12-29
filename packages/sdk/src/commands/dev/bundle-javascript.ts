// packages/sdk/src/commands/dev/bundle-javascript.ts

import chokidar from 'chokidar'
import { prepareBuildContext, type BuildContextError } from './prepare-build-context.js'
import { isErrored, isComplete, complete, type Fetchable } from '../../errors.js'
import { compileAndExtractSettingsSchema } from '../../util/compile-and-extract-settings.js'
import { type SettingsSchema } from '../../util/extract-settings-schema.js'

/**
 * Build context interface for managing client and server builds
 */
type BuildContext = {
  /** Rebuilds client and server bundles */
  rebuild: () => Promise<Fetchable<any, BuildContextError>>
  /** Disposes of build resources with timeout */
  dispose: (timeoutMs: number) => Promise<Fetchable<void, BuildContextError>>
}

/**
 * Bundles JavaScript files and watches for changes in development mode.
 *
 * This function sets up a file watcher for TypeScript/JavaScript files in the src directory
 * and automatically rebuilds when files change. It handles build queuing to prevent
 * concurrent builds and provides callbacks for success/error handling.
 *
 * Additionally compiles app.settings.ts (if present) as part of the build process,
 * extracting the settings schema to be included in bundle uploads.
 *
 * @param onSuccess - Optional callback invoked when build succeeds. Receives:
 *                    - bundles: [clientBundle, serverBundle] as strings
 *                    - settingsSchema: Extracted settings schema (if USE_SETTINGS enabled)
 * @param onError - Optional callback invoked when build fails. Receives a BuildContextError
 *                  with detailed error information.
 * @returns An async cleanup function that stops the file watcher, waits for any in-progress
 *          builds to complete, and disposes of the build context.
 *
 * @example
 * ```typescript
 * const cleanup = bundleJavaScript(
 *   ([client, server], settingsSchema) => {
 *     console.log('Build succeeded')
 *     if (settingsSchema) console.log('Settings:', settingsSchema)
 *   },
 *   (error) => {
 *     console.error('Build failed:', error)
 *   }
 * )
 *
 * // Later, cleanup when done
 * await cleanup()
 * ```
 */
export function bundleJavaScript(
  onSuccess?: (bundles: [string, string], settingsSchema?: SettingsSchema) => Promise<void> | void,
  onError?: (error: BuildContextError) => void
): () => Promise<void> {
  // Watch all JS/TS files in src directory
  const watcher = chokidar.watch(['./src/**/*.{js,jsx,ts,tsx}'], {
    ignored: ['**/node_modules/**', '**/dist/**', '**/*.graphql.d.ts', '**/*.gql.d.ts'],
    cwd: process.cwd(),
  })

  /** Cached build context to avoid recreating on each rebuild */
  let buildContext: BuildContext | undefined

  /** Flag to prevent concurrent builds */
  let isBuilding = false

  /** Flag to queue a build when one is already in progress */
  let buildQueued = false

  /** Flag to prevent new builds during cleanup */
  let isDisposing = false

  /**
   * Handles the build process, including creating the build context on first run,
   * rebuilding bundles, and calling success/error callbacks.
   *
   * Implements build queuing: if a build is requested while another is in progress,
   * it will run again after the current build completes.
   *
   * @returns Fetchable result indicating success or containing error details
   */
  async function handleBuild(): Promise<Fetchable<void, BuildContextError>> {
    if (isBuilding || isDisposing) {
      buildQueued = true
      return complete(undefined)
    }
    isBuilding = true
    try {
      if (!buildContext) {
        const buildContextResult = await prepareBuildContext('in-memory')
        if (isErrored(buildContextResult)) {
          return buildContextResult
        }
        if (isComplete(buildContextResult)) {
          buildContext = buildContextResult.value
        } else {
          return buildContextResult
        }
      }
      const bundleResults = await buildContext.rebuild()
      if (isErrored(bundleResults)) {
        return bundleResults
      }
      if (!isComplete(bundleResults)) {
        return bundleResults
      }
      const results = bundleResults.value

      // Compile and extract settings schema if enabled
      const settingsSchema = await compileAndExtractSettingsSchema()

      await onSuccess?.(
        [results.client.outputFiles[0].text, results.server.outputFiles[0].text],
        settingsSchema
      )
      isBuilding = false
      if (buildQueued && !isDisposing) {
        buildQueued = false
        return await handleBuild()
      }
      return complete(undefined)
    } finally {
      isBuilding = false
    }
  }

  // Initial build when watcher is ready
  watcher.on('ready', async () => {
    const result = await handleBuild()
    if (isErrored(result)) {
      onError?.(result.error)
    }

    // Set up file change listener after initial build
    watcher.on('all', async (event) => {
      // Rebuild on file add, change, or delete
      if (event === 'add' || event === 'change' || event === 'unlink') {
        const result = await handleBuild()
        if (isErrored(result)) {
          onError?.(result.error)
        }
      }
    })
  })

  /**
   * Cleanup function that gracefully shuts down the bundler.
   *
   * This function:
   * 1. Sets the disposing flag to prevent new builds
   * 2. Waits for any in-progress build to complete
   * 3. Closes the file watcher
   * 4. Disposes of the build context with a 1-second timeout
   *
   * @returns Promise that resolves when cleanup is complete
   */
  return async () => {
    isDisposing = true

    // Wait for current build to finish
    if (isBuilding) {
      await new Promise<void>((resolve) => {
        const checkBuild = setInterval(() => {
          if (!isBuilding) {
            clearInterval(checkBuild)
            resolve(undefined)
          }
        }, 10)
      })
    }

    // Close file watcher
    await watcher.close()

    // Dispose build context
    if (buildContext) {
      const result = await buildContext.dispose(1_000)
      if (isErrored(result)) {
        process.stderr.write(`Error disposing build context: ${result.error}\n`)
      }
      buildContext = undefined
    }
  }
}
