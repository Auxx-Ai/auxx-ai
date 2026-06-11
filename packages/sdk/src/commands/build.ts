// packages/sdk/src/commands/build.ts

import chalk from 'chalk'
import { Command } from 'commander'
import type { Message } from 'esbuild'
import { isErrored } from '../errors.js'
import { ensureAppEntryPoint } from '../util/ensure-app-entry-point.js'
import { printJsError } from '../util/error-reporting.js'
import { hardExit } from '../util/hard-exit.js'
import { spinnerify } from '../util/spinner.js'
import { buildJavaScript } from './build/build-javascript.js'
import { validateTypeScriptOrExit } from './build/validate-typescript.js'

/**
 * Build command - compiles the Auxx app for production
 *
 * Process:
 * 1. Validate entry point exists
 * 2. Validate TypeScript
 * 3. Bundle JavaScript with esbuild
 * 4. Output to .auxx/build.js
 */
export const build = new Command('build')
  .description('Build your Auxx app for production')
  .action(async () => {
    try {
      // Step 1: Ensure entry point exists
      const entryPointResult = await ensureAppEntryPoint()
      if (isErrored(entryPointResult)) {
        hardExit(
          `Could not find app entry point at ${entryPointResult.error}\n` +
            `  Make sure you have a src/index.ts file in your project.`
        )
      }

      // Step 2: Validate TypeScript
      await validateTypeScriptOrExit()

      // Step 3: Build JavaScript
      const buildResult = await spinnerify(
        'Building JavaScript...',
        'JavaScript build completed',
        buildJavaScript
        // () => buildJavaScript(true) // minify for production
      )

      if (isErrored(buildResult)) {
        if (buildResult.error.code === 'BUILD_JAVASCRIPT_ERROR') {
          process.stdout.write('\n')

          if (buildResult.error.errors && buildResult.error.errors.length > 0) {
            process.stderr.write(
              chalk.red(`✖ Build failed with ${buildResult.error.errors.length} error(s):\n`)
            )
            buildResult.error.errors.forEach((error: Message) => printJsError(error, 'error'))
          }

          if (buildResult.error.warnings && buildResult.error.warnings.length > 0) {
            process.stderr.write(
              chalk.yellow(`⚠ Build warnings (${buildResult.error.warnings.length}):\n`)
            )
            buildResult.error.warnings.forEach((warning: Message) =>
              printJsError(warning, 'warning')
            )
          }

          process.exit(1)
        }

        hardExit('Build failed: ' + buildResult.error.error.message)
      }

      // Step 4: Success!
      // printBuildSummary(buildResult.value)

      // process.stdout.write(
      //   chalk.dim(`Run ${chalk.cyan('auxx deploy')} to deploy your app to production.\n\n`)
      // )
    } catch (error) {
      hardExit(`Unexpected error: ${error}`)
    }
  })
