// // packages/sdk/src/commands/build/build-javascript.ts

import { complete, isErrored } from '../../errors.js'
import { prepareBuildContext } from '../dev/prepare-build-context.js'
export async function buildJavaScript() {
  const buildContextResult = await prepareBuildContext('write-to-disk')
  if (isErrored(buildContextResult)) {
    return buildContextResult
  }
  const buildContext = buildContextResult.value
  const buildResult = await buildContext.rebuild()
  const disposeResult = await buildContext.dispose(1_000)
  if (isErrored(disposeResult)) {
    return disposeResult
  }
  if (isErrored(buildResult)) {
    return buildResult
  }
  return complete(true)
}

// import * as esbuild from 'esbuild'
// import { mkdir } from 'fs/promises'
// import path from 'path'
// import { createBuildConfig } from '../../build/create-build-config.js'
// import { complete, errored } from '../../errors.js'

// export type BuildError =
//   | {
//       code: 'BUILD_JAVASCRIPT_ERROR'
//       errors?: esbuild.Message[]
//       warnings?: esbuild.Message[]
//     }
//   | { code: 'FILE_SYSTEM_ERROR'; error: Error }

// export interface BuildResult {
//   outfile: string
//   size: number
//   duration: number
// }

// /**
//  * Build the Auxx app using esbuild
//  * Outputs to .auxx/build.js
//  */
// export async function buildJavaScript(minify = true) {
//   const startTime = Date.now()

//   try {
//     const cwd = process.cwd()
//     const outDir = path.join(cwd, '.auxx')
//     const outfile = path.join(outDir, 'build.js')

//     // Ensure .auxx directory exists
//     await mkdir(outDir, { recursive: true })

//     // Build configuration
//     const config = createBuildConfig({
//       entryPoint: path.join(cwd, 'src', 'index.ts'),
//       outfile,
//       minify,
//       sourcemap: true,
//     })

//     // Build
//     const result = await esbuild.build(config)

//     // Check for errors and warnings
//     if (result.errors.length > 0 || result.warnings.length > 0) {
//       return errored({
//         code: 'BUILD_JAVASCRIPT_ERROR',
//         errors: result.errors,
//         warnings: result.warnings,
//       })
//     }

//     // Calculate bundle size from metafile
//     let size = 0
//     if (result.metafile) {
//       const outputs = Object.values(result.metafile.outputs)
//       size = outputs.reduce((acc, output) => acc + output.bytes, 0)
//     }

//     const duration = Date.now() - startTime

//     return complete({
//       outfile,
//       size,
//       duration,
//     })
//   } catch (error) {
//     return errored({
//       code: 'FILE_SYSTEM_ERROR',
//       error: error instanceof Error ? error : new Error(String(error)),
//     })
//   }
// }
