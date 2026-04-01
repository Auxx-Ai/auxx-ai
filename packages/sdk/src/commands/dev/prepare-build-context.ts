// packages/sdk/src/commands/dev/prepare-build-context.ts

/**
 * @file Manages the build context for both client and server bundles during development and production builds.
 * Creates and coordinates ClientBuilder and ServerBuilder instances with proper error handling.
 */

import chalk from 'chalk'
import path from 'path'
import { findWorkflowBlockModules } from '../../build/server/find-workflow-block-server-modules.js'
import {
  combine,
  combineAsync,
  complete,
  isComplete,
  isErrored,
  map,
  type Result,
} from '../../errors.js'
// import { findWorkflowBlockModules } from '../../build/server/find-workflow-block-server-modules.js'
import { type BuildMode, ClientBuilder } from './client-builder.js'
import { ServerBuilder } from './server-builder.js'

/**
 * Union type of all possible build context errors that can occur during the build process.
 * Each error code represents a specific failure point in the build pipeline.
 */
export type BuildContextError =
  /** Failed to create a temporary file at the specified path */
  | { code: 'FAILED_TO_CREATE_TEMP_FILE'; path: string }
  /** Failed to generate the client entry point bundle */
  | { code: 'FAILED_TO_GENERATE_CLIENT_ENTRY' }
  /** Failed to properly dispose of build context resources */
  | { code: 'FAILED_TO_DISPOSE_OF_BUILD_CONTEXT'; error: Error }
  /** Failed to create esbuild context for the specified output file */
  | { code: 'FAILED_TO_CREATE_ESBUILD_CONTEXT'; outfile: string; error: Error }
  /** Error occurred while finding surface-level exports */
  | { code: 'ERROR_FINDING_SURFACE_EXPORTS'; error: Error }
  /** The app entry point (app.ts) was not found */
  | { code: 'APP_ENTRY_POINT_NOT_FOUND' }
  /** The required "app" export was not found in the entry point file */
  | { code: 'APP_EXPORT_NOT_FOUND'; path: string }
  /** Failed to parse a build error message */
  | { code: 'UNPARSABLE_BUILD_ERROR'; error: Error }
  /** Error occurred while finding server function modules */
  | { code: 'ERROR_FINDING_SERVER_FUNCTION_MODULES'; cause: Error }
  /** Failed to resolve workflow block modules */
  | { code: 'WORKFLOW_BLOCK_RESOLUTION_FAILED'; message: string }
  | { code: 'BUILD_JAVASCRIPT_ERROR'; message: string; errors: []; warnings: [] }

/**
 * Represents the build context containing client and server builders with methods
 * to rebuild and dispose of build resources.
 */
type BuildContext = {
  /** Rebuilds both client and server bundles */
  rebuild: () => Promise<Result<any, BuildContextError>>
  /** Disposes of all build contexts and cleans up resources */
  dispose: (timeoutMs: number) => Promise<Result<void, BuildContextError>>
}

/**
 * Prepares the build context by initializing both client and server builders with their
 * respective configurations and directory structures.
 *
 * @param mode - The build mode ('development' or 'production') determining optimization level
 * @returns A Result containing either the BuildContext with rebuild/dispose methods or a BuildContextError
 *
 * @example
 * ```typescript
 * const buildContext = await prepareBuildContext('development')
 * if (isComplete(buildContext)) {
 *   await buildContext.value.rebuild()
 * }
 * ```
 */
export async function prepareBuildContext(
  mode: BuildMode
): Promise<Result<BuildContext, BuildContextError>> {
  const appDir = ''
  const srcDir = 'src'
  const assetsDir = path.join(srcDir, 'assets')
  const webhooksDir = path.join(srcDir, 'webhooks')
  const eventsDir = path.join(srcDir, 'events')

  const buildersResult = await combineAsync({
    client: ClientBuilder.create({
      outfile: path.resolve('dist', 'index.js'),
      directories: {
        app: appDir,
        src: srcDir,
        assets: assetsDir,
      },
      mode,
    }),
    server: ServerBuilder.create({
      outfile: path.resolve('dist', 'server.js'),
      directories: {
        app: appDir,
        src: srcDir,
        webhooks: webhooksDir,
        events: eventsDir,
      },
      mode,
    }),
  })
  if (!isComplete(buildersResult)) {
    return buildersResult
  }
  const { client, server } = buildersResult.value as { client: any; server: any }
  return complete({
    rebuild: async () => {
      const workflowBlockModulesResult = await findWorkflowBlockModules(srcDir)
      if (isErrored(workflowBlockModulesResult)) {
        return workflowBlockModulesResult
      }
      const { blocks: workflowBlockModules, quickActions: quickActionModules } =
        workflowBlockModulesResult.value
      return combineAsync({
        client: client.rebuild({ workflowBlockModules, quickActionModules }),
        server: server.rebuild({ workflowBlockModules, quickActionModules }),
      })
      // return complete({})
    },
    dispose: async (timeoutMs: number): Promise<Result<void, BuildContextError>> => {
      const clientResult = await client.dispose(timeoutMs)
      const serverResult = await server.dispose(timeoutMs)
      return map(combine([clientResult, serverResult]), () => undefined)
    },
  })
}
/**
 * Prints formatted error messages to stderr based on the BuildContextError code.
 * Each error type is displayed with a red cross symbol and descriptive message.
 *
 * @param error - The BuildContextError to print
 *
 * @example
 * ```typescript
 * const result = await prepareBuildContext('development')
 * if (!isComplete(result)) {
 *   printBuildContextError(result.error)
 * }
 * ```
 */
export function printBuildContextError(error: BuildContextError): void {
  switch (error.code) {
    case 'FAILED_TO_CREATE_TEMP_FILE':
      process.stderr.write(`${chalk.red('✖ ')}Failed to create temp file: ${error.path}\n`)
      break
    case 'FAILED_TO_GENERATE_CLIENT_ENTRY':
      process.stderr.write(`${chalk.red('✖ ')}Failed to generate client entry\n`)
      break
    case 'FAILED_TO_DISPOSE_OF_BUILD_CONTEXT':
      process.stderr.write(`${chalk.red('✖ ')}Failed to dispose of build context: ${error.error}\n`)
      break
    case 'FAILED_TO_CREATE_ESBUILD_CONTEXT':
      process.stderr.write(
        `${chalk.red('✖ ')}Failed to create esbuild context (${error.outfile}): ${error.error}\n`
      )
      break
    case 'ERROR_FINDING_SURFACE_EXPORTS':
      process.stderr.write(`${chalk.red('✖ ')}Failed to find surface exports: ${error.error}\n`)
      break
    case 'APP_ENTRY_POINT_NOT_FOUND':
      process.stderr.write(`${chalk.red('✖ ')}Could not find app.ts\n`)
      break
    case 'APP_EXPORT_NOT_FOUND':
      process.stderr.write(
        `${chalk.red('✖ ')}Could not find a named export "app" in ${path.basename(error.path)}.\n`
      )
      break
    case 'UNPARSABLE_BUILD_ERROR':
      process.stderr.write(`${chalk.red('✖ ')}Failed to parse build error: ${error.error}\n`)
      break
    case 'ERROR_FINDING_SERVER_FUNCTION_MODULES':
      process.stderr.write(`${chalk.red('✖ ')}Failed to find server modules: ${error.cause}\n`)
      break
    case 'WORKFLOW_BLOCK_RESOLUTION_FAILED':
      process.stderr.write(
        `${chalk.red('✖ ')}Failed to build workflow block(s): ${error.message}\n`
      )
      break
  }
}
