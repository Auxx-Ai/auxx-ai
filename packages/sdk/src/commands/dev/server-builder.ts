// packages/sdk/src/commands/dev/server-builder.ts
import fs from 'fs/promises'
import path from 'path'
import * as esbuild from 'esbuild'
import tmp from 'tmp-promise'
import { complete, errored, isErrored, errorsAndWarningsSchema, type Result } from '../../errors.js'
import { createServerBuildConfig } from '../../build/server/create-server-build-config.js'
import { generateServerEntry } from '../../build/server/generate-server-entry.js'
import type { BuildMode } from './client-builder.js'

/**
 * Describes a temporary file generated for feeding source code into esbuild.
 */
type TempFile = {
  /** Absolute path to the generated temporary file. */
  path: string
  /** Callback responsible for cleaning up the temporary file. */
  cleanup: () => Promise<void>
}

/**
 * Maps the important server-side workspace directories used at build time.
 */
type ServerDirectories = {
  /** Path to the active application directory. */
  app: string
  /** Path to the source directory that contains shared code. */
  src: string
  /** Path to webhook handler implementations. */
  webhooks: string
  /** Path to event handler implementations. */
  events: string
}

/**
 * Configuration options required to instantiate a {@link ServerBuilder}.
 */
type ServerBuilderOptions = {
  /** Established esbuild context reused across rebuild calls. */
  esbuildContext: esbuild.BuildContext
  /** Temporary file abstraction used for incremental rebuilds. */
  tempFile: TempFile
  /** Collection of directories needed to synthesize the entry file. */
  directories: ServerDirectories
}

/**
 * Orchestrates server bundle rebuilds by generating an entry file and delegating to esbuild.
 */
export class ServerBuilder {
  private _lastJs: string | undefined
  private _esbuildContext: esbuild.BuildContext
  private _tempFile: TempFile
  private _directories: ServerDirectories

  /**
   * Create a server builder with an existing esbuild context and temp file.
   *
   * @param esbuildContext Active esbuild context reused for incremental rebuilds.
   * @param tempFile Temporary file wrapper that stores the generated entry source.
   * @param directories Directory map used to produce the entry source.
   */
  constructor({ esbuildContext, tempFile, directories }: ServerBuilderOptions) {
    this._esbuildContext = esbuildContext
    this._tempFile = tempFile
    this._directories = directories
  }

  /**
   * Establish a {@link ServerBuilder} with a fresh esbuild context and temp file.
   *
   * @param outfile Path to the compiled server bundle when `mode` writes to disk.
   * @param directories Directory locations required to generate the server entry.
   * @param mode Build mode that decides whether esbuild writes output to disk.
   * @returns A {@link Result} containing the created builder or initialization error details.
   */
  static async create({
    outfile,
    directories,
    mode,
  }: {
    outfile: string
    directories: ServerDirectories
    mode: BuildMode
  }): Promise<Result<ServerBuilder, any>> {
    try {
      const tempFile = await tmp.file({ postfix: '.js' })
      const esbuildContext = await esbuild.context({
        ...createServerBuildConfig(tempFile.path),
        write: mode === 'write-to-disk',
        outfile,
      } as esbuild.BuildOptions)
      return complete(new ServerBuilder({ esbuildContext, tempFile, directories }))
    } catch (error) {
      return errored({
        code: 'FAILED_TO_CREATE_ESBUILD_CONTEXT',
        outfile,
        error,
      })
    }
  }

  /**
   * Rebuild the server bundle by regenerating the dynamic entry file and invoking esbuild.
   *
   * @param workflowBlockModules Modules referenced by workflow blocks participating in the build.
   * @returns A {@link Result} containing the esbuild {@link esbuild.BuildResult} or build errors.
   */
  async rebuild({ workflowBlockModules }: { workflowBlockModules: Map<string, any> }): Promise<Result<esbuild.BuildResult, any>> {
    const jsResult = await generateServerEntry({
      appDirAbsolute: path.resolve(this._directories.app),
      srcDirAbsolute: path.resolve(this._directories.src),
      webhooksDirAbsolute: path.resolve(this._directories.webhooks),
      eventDirAbsolute: path.resolve(this._directories.events),
      workflowBlockModules,
      log: console.log,
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
   * Dispose of esbuild resources and delete temporary files within a bounded time frame.
   *
   * @param timeoutMs Maximum time in milliseconds to wait before timing out disposal work.
   * @returns A {@link Result} that indicates success or disposal failure details.
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
