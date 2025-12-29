// packages/sdk/src/commands/build.ts

import { Command } from 'commander'
import chalk from 'chalk'
import { ensureAppEntryPoint } from '../util/ensure-app-entry-point.js'
import { hardExit } from '../util/hard-exit.js'
import { spinnerify } from '../util/spinner.js'
import { printTsError, printJsError } from '../util/error-reporting.js'
import { validateTypeScript } from './build/validate-typescript.js'
import { buildJavaScript } from './build/build-javascript.js'
import { isErrored } from '../errors.js'
import type { Message } from 'esbuild'

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
      const tsResult = await spinnerify(
        'Validating TypeScript...',
        'TypeScript validation passed',
        validateTypeScript
      )

      if (isErrored(tsResult)) {
        if (tsResult.error.code === 'VALIDATE_TYPESCRIPT_ERROR') {
          process.stdout.write('\n')
          process.stderr.write(
            chalk.red(`✖ Found ${tsResult.error.errors.length} TypeScript error(s):\n`)
          )

          // Print first 10 errors
          const errorsToShow = tsResult.error.errors.slice(0, 10)
          for (const error of errorsToShow) {
            await printTsError(error)
          }

          if (tsResult.error.errors.length > 10) {
            process.stderr.write(
              chalk.yellow(`\n  ... and ${tsResult.error.errors.length - 10} more error(s)\n`)
            )
          }

          process.exit(1)
        }

        hardExit('TypeScript validation failed: ' + tsResult.error.error.message)
      }

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
