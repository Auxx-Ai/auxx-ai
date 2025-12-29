// packages/sdk/src/commands/dev/client-builder.ts

import fs from 'fs/promises'
import path from 'path'
import * as esbuild from 'esbuild'
import tmp from 'tmp-promise'
import { complete, errored, errorsAndWarningsSchema, isErrored, type Result } from '../../errors.js'
import { createClientBuildConfig } from '../../build/client/create-client-build-config.js'
import { generateClientEntry } from '../../build/client/generate-client-entry.js'

/**
 * Describes the temporary file that holds the generated client entry source.
 */
type TempFile = {
  path: string
  cleanup: () => Promise<void>
}

/**
 * Absolute directory references required by the client builder.
 */
type Directories = {
  app: string
  src: string
  assets: string
}

/**
 * Mutable reference that tracks runtime-resolved workflow block modules.
 */
type WorkflowBlockModulesRef = {
  current: Map<string, any>
}

/**
 * Build mode for esbuild
 * - 'in-memory': Keep build results in memory only
 * - 'write-to-disk': Write build results to disk
 */
export type BuildMode = 'in-memory' | 'write-to-disk'

/**
 * Construction options required to create a `ClientBuilder` instance.
 */
type ClientBuilderOptions = {
  tempFile: TempFile
  directories: Directories
  workflowBlockModulesRef: WorkflowBlockModulesRef
  esbuildContext: esbuild.BuildContext
}

/**
 * Orchestrates incremental client-side JavaScript builds via esbuild.
 */
export class ClientBuilder {
  private _lastJs: string | undefined
  private _esbuildContext: esbuild.BuildContext
  private _tempFile: TempFile
  private _directories: Directories
  private _workflowBlockModulesRef: WorkflowBlockModulesRef

  /**
   * Create a `ClientBuilder` with the provided dependencies.
   *
   * @param tempFile Temporary file container for the generated entry point.
   * @param directories Absolute app, source, and asset directory locations.
   * @param workflowBlockModulesRef Mutable workflow module registry reference.
   * @param esbuildContext Existing esbuild context configured for rebuilds.
   */
  constructor({
    tempFile,
    directories,
    workflowBlockModulesRef,
    esbuildContext,
  }: ClientBuilderOptions) {
    this._esbuildContext = esbuildContext
    this._tempFile = tempFile
    this._workflowBlockModulesRef = workflowBlockModulesRef
    this._directories = directories
  }

  /**
   * Create a new `ClientBuilder` backed by a freshly configured esbuild context.
   *
   * @param outfile Final build output location used by esbuild when writing.
   * @param directories Absolute app, source, and asset directory locations.
   * @param mode Whether to persist output to disk or keep it in memory only.
   * @returns A `Result` containing the builder or a structured creation error.
   */
  static async create({
    outfile,
    directories,
    mode,
  }: {
    outfile: string
    directories: Directories
    mode: BuildMode
  }): Promise<Result<ClientBuilder, any>> {
    try {
      const workflowBlockModulesRef = { current: new Map() }
      const tempFile = await tmp.file({ postfix: '.js' })

      // Read package.json for app metadata
      let appName = 'unknown'
      try {
        const pkgJson = JSON.parse(await fs.readFile('package.json', 'utf-8'))
        appName = pkgJson.name || 'unknown'
      } catch {
        // Ignore if package.json not found
      }

      const esbuildContext = await esbuild.context({
        ...createClientBuildConfig({
          appDir: directories.app,
          entryPoint: tempFile.path,
          srcDir: directories.src,
          workflowBlockModulesRef,
        }),
        banner: {
          js: `/* App: ${appName} | Built: ${new Date().toISOString()} */`
        },
        write: mode === 'write-to-disk',
        outfile,
        loader: { '.png': 'dataurl', '.graphql': 'text', '.gql': 'text' },
      } as esbuild.BuildOptions)

      return complete(
        new ClientBuilder({ esbuildContext, tempFile, workflowBlockModulesRef, directories })
      )
    } catch (error) {
      return errored({
        code: 'FAILED_TO_CREATE_ESBUILD_CONTEXT',
        outfile,
        error,
      })
    }
  }

  /**
   * Rebuild the client bundle with the latest workflow block modules.
   *
   * @param workflowBlockModules Workflow modules resolved for the current build.
   * @returns A `Result` that contains the esbuild result or a build failure.
   */
  async rebuild({
    workflowBlockModules,
  }: {
    workflowBlockModules: Map<string, any>
  }): Promise<Result<esbuild.BuildResult, any>> {
    this._workflowBlockModulesRef.current = workflowBlockModules
    const jsResult = await generateClientEntry({
      srcDirAbsolute: path.resolve(this._directories.src),
      assetsDirAbsolute: path.resolve(this._directories.assets),
    })

    if (isErrored(jsResult)) {
      return jsResult
    }
    const js = jsResult.value
    if (js !== this._lastJs) {
      try {
        await fs.writeFile(this._tempFile.path, js)
        this._lastJs = js
      } catch (error) {
        return errored({
          code: 'FAILED_TO_CREATE_TEMP_FILE',
          path: this._tempFile.path,
          error,
        })
      }
    }
    try {
      return complete(await this._esbuildContext.rebuild())
    } catch (error) {
      const parseResult = errorsAndWarningsSchema.safeParse(error)
      if (!parseResult.success) {
        return errored({
          code: 'UNPARSABLE_BUILD_ERROR',
          error,
        })
      }
      return errored({
        code: 'BUILD_JAVASCRIPT_ERROR',
        errors: parseResult.data.errors ?? [],
        warnings: parseResult.data.warnings ?? [],
      })
    }
  }

  /**
   * Dispose of the build context and cleanup temp files within the timeout window.
   *
   * @param timeoutMs Maximum time to wait for disposal before aborting.
   * @returns A `Result` signalling either success or disposal failure.
   */
  async dispose(timeoutMs: number): Promise<Result<void, any>> {
    try {
      await Promise.race([
        Promise.all([this._esbuildContext.dispose(), this._tempFile.cleanup()]),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Context disposal timeout')), timeoutMs)
        ),
      ])
    } catch (error) {
      return errored({
        code: 'FAILED_TO_DISPOSE_OF_BUILD_CONTEXT',
        error,
      })
    }
    return complete(undefined)
  }
}
