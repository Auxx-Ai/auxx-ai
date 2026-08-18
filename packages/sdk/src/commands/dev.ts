import chalk from 'chalk'
import { Command, Option } from 'commander'
import notifier from 'node-notifier'
import { z } from 'zod'
import { authenticator } from '../auth/auth.js'
import { HIDDEN_AUXX_DIRECTORY } from '../constants/hidden-auxx-directory.js'
import { USE_APP_TS, USE_SETTINGS } from '../env.js'
import { isErrored } from '../errors.js'
import { printUploadError } from '../print-errors.js'
import { addAuxxHiddenDirectoryToTsConfig } from '../util/add-auxx-hidden-directory-to-ts-config.js'
import { ensureAppEntryPoint } from '../util/ensure-app-entry-point.js'
import { ensureAppFieldsTypes } from '../util/ensure-app-fields-types.js'
import { generateAppEnvTypes } from '../util/generate-app-env-types.js'
import { generateGitignore } from '../util/generate-gitignore.js'

import { generateSettingsFiles } from '../util/generate-settings-files.js'
import { hardExit } from '../util/hard-exit.js'
import { printMessage } from '../util/print-message.js'
import { spinnerify } from '../util/spinner.js'
import { printJsError, printTsError } from '../util/typescript.js'
import { boot } from './dev/boot.js'
import { bundleJavaScript } from './dev/bundle-javascript.js'
// import { graphqlServer } from './dev/graphql-server.js'
import { onboarding } from './dev/onboarding.js'
import { printBuildContextError } from './dev/prepare-build-context.js'
import { upload } from './dev/upload.js'
import { validateTypeScript } from './dev/validate-typescript.js'
import { bundleJavaScript as bundleOnce } from './version/create/bundle-javascript.js'

const notifyTsErrors = (errors: any[]) => {
  try {
    notifier.notify({
      title: `TypeScript Error${errors.length === 1 ? '' : 's'}`,
      message: `There ${errors.length === 1 ? 'was one error' : `were ${errors.length} errors`} in your TypeScript code`,
    })
  } catch {}
}
const notifyJsErrors = (errors: { errors: []; warnings: [] }) => {
  const totalErrors = (errors.errors?.length || 0) + (errors.warnings?.length || 0)
  try {
    notifier.notify({
      title: `JavaScript ${totalErrors === 1 ? 'Error' : 'Errors'}`,
      message: `There ${totalErrors === 1 ? 'was one error' : `were ${totalErrors} errors`} in your JavaScript code`,
    })
  } catch {}
}

export const optionsSchema = z.object({
  organization: z.string().optional(),
  once: z.boolean().optional(),
})
type CleanupFunction = () => void

export const dev = new Command('dev')
  .description('Develop your Auxx.ai app')
  .addOption(new Option('-o, --organization <handle>', 'The handle of the organization to use'))
  .addOption(
    new Option(
      '--once',
      'Deploy once and exit — bundle, extract the catalog, upload, create the development deployment. No local server, no file watching.'
    )
  )
  .action(async (unparsedOptions) => {
    const { organization: organizationSlug, once } = optionsSchema.parse(unparsedOptions)

    const cleanupFunctions: CleanupFunction[] = []

    let isCleaningUp = false
    if (USE_APP_TS) {
      const appEntryPointResult = await ensureAppEntryPoint(true)
      if (isErrored(appEntryPointResult)) {
        switch (appEntryPointResult.error.code) {
          case 'APP_ENTRY_POINT_NOT_FOUND':
            hardExit('Could not find app.ts')
          case 'FAILED_TO_GENERATE_ENTRY_POINT':
            hardExit('Failed to generate app.ts')
        }
      }
    }
    await generateGitignore()
    const appEnvTypesResult = await generateAppEnvTypes()
    if (isErrored(appEnvTypesResult)) {
      process.stderr.write(
        chalk.yellow(
          `Failed to generate src/auxx-env.d.ts at ${appEnvTypesResult.error.path}. TypeScript image imports may show warnings.\n`
        )
      )
    } else if (appEnvTypesResult.value === 'skipped_unmanaged') {
      process.stderr.write(
        chalk.yellow(
          'Skipping src/auxx-env.d.ts generation because the existing file is unmanaged. Add imports for @auxx/sdk/client and @auxx/sdk/global manually.\n'
        )
      )
    }
    await ensureAppFieldsTypes()
    if (USE_SETTINGS) {
      const updateTsconfigResult = await addAuxxHiddenDirectoryToTsConfig()
      if (isErrored(updateTsconfigResult)) {
        switch (updateTsconfigResult.error.code) {
          case 'TS_CONFIG_NOT_FOUND':
          case 'FAILED_TO_READ_TSCONFIG':
          case 'FAILED_TO_PARSE_TSCONFIG':
          case 'FAILED_TO_WRITE_TSCONFIG':
            process.stderr.write(
              chalk.yellow(
                `Failed to update tsconfig. Make sure the "include" field contains the ${HIDDEN_AUXX_DIRECTORY} directory \n`
              )
            )
            break
          default:
            throw new Error(updateTsconfigResult.error.code)
        }
      }
      const generateResult = await generateSettingsFiles()
      if (isErrored(generateResult)) {
        hardExit('Failed to generate settings files')
      }
    }
    await authenticator.ensureAuthed()
    const cleanup = async () => {
      if (isCleaningUp) return
      isCleaningUp = true
      try {
        for (const cleanup of cleanupFunctions.reverse()) {
          try {
            await Promise.race([
              cleanup(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Cleanup timeout')), 2000)
              ),
            ])
          } catch (error) {
            process.stderr.write(chalk.yellow(`Warning during cleanup: ${error}\n`))
          }
        }
      } catch (error) {
        process.stderr.write(chalk.red(`Error during cleanup: ${error}\n`))
      }
    }
    try {
      // `--once` refuses to PROMPT for the organization. `determineOrganization`
      // asks when the account has several and none was named — fine for an
      // interactive session, a hang for the batch loop that this flag exists to
      // serve (stdout piped, nobody watching). One org, or `-o`, or refuse.
      if (once && !organizationSlug && !process.stdin.isTTY) {
        hardExit('`auxx dev --once` needs an organization: pass -o <handle>.')
      }

      const { appId, appSlug, organization, environmentVariables, cliVersion } = await boot({
        organizationSlug,
      })

      // One-shot: exactly what a watch cycle uploads, without becoming a
      // watcher. `version create`'s bundler is reused deliberately — it is the
      // one that runs `compileAndExtractCatalog()` and fails loudly when
      // extraction breaks, which is the whole point of deploying at all.
      if (once) {
        const bundleResult = await spinnerify(
          'Bundling JavaScript...',
          'Bundling complete',
          bundleOnce
        )
        if (isErrored(bundleResult)) {
          if (bundleResult.error.code === 'ERROR_EXTRACTING_CATALOG') {
            const catalogError = bundleResult.error.error
            const detail =
              'message' in catalogError
                ? catalogError.message
                : 'error' in catalogError
                  ? catalogError.error.message
                  : ''
            hardExit(
              `Catalog extraction failed (${catalogError.code})${detail ? `: ${detail}` : ''}`
            )
          }
          if (bundleResult.error.code === 'ERROR_BUILDING_BUNDLE') {
            const { error } = bundleResult.error
            if (error.code === 'BUILD_JAVASCRIPT_ERROR') {
              error.errors?.forEach((e: any) => printJsError(e, 'error'))
              error.warnings?.forEach((w: any) => printJsError(w, 'warning'))
            } else {
              printBuildContextError(error)
            }
            process.exit(1)
          }
          hardExit(`Build failed: ${JSON.stringify(bundleResult.error)}`)
        }
        const { bundles, settingsSchema, catalog } = bundleResult.value
        const uploadResult = await upload({
          contents: bundles,
          appId,
          targetOrganizationId: organization.id,
          environmentVariables,
          cliVersion,
          settingsSchema,
          catalog,
        })
        if (isErrored(uploadResult)) {
          printUploadError(uploadResult)
          process.exit(1)
        }
        process.stdout.write(
          `${chalk.green('✓ ')}Development deployment created for ${organization.name}\n`
        )
        process.exit(0)
      }

      // const cleanupGraphqlServer = graphqlServer()

      // cleanupFunctions.push(cleanupGraphqlServer)

      const cleanupOnboardingDaemon = onboarding({ appId, appSlug, organization })
      cleanupFunctions.push(cleanupOnboardingDaemon)
      let haveTsErrors = false
      const [cleanupTs, _triggerTs] = validateTypeScript(
        () => {
          if (haveTsErrors) {
            process.stdout.write(`${chalk.green('✓')} TypeScript errors fixed\n`)
            haveTsErrors = false
          }
        },
        (errors) => {
          haveTsErrors = true
          errors.forEach(printTsError)
          notifyTsErrors(errors)
        }
      )
      cleanupFunctions.push(cleanupTs)
      // let hasGraphqlCodeGenError = false
      // const cleanupGraphqlCodeGen = watchGraphqlCodegen(
      //   () => {
      //     if (hasGraphqlCodeGenError) {
      //       process.stdout.write(`${chalk.green('✓')} GraphQL errors fixed\n`)
      //       hasGraphqlCodeGenError = false
      //     }
      //     triggerTs()
      //   },
      //   (error) => {
      //     hasGraphqlCodeGenError = true
      //     process.stderr.write(error)
      //   }
      // )
      // cleanupFunctions.push(cleanupGraphqlCodeGen)
      let haveBundlingErrors = false
      const cleanupJs = bundleJavaScript(
        async (contents, settingsSchema, catalog) => {
          if (haveBundlingErrors) {
            process.stdout.write(`${chalk.green('✓')} Bundling errors fixed\n`)
            haveBundlingErrors = false
          }
          const uploadResult = await upload({
            contents,
            appId,
            targetOrganizationId: organization.id,
            environmentVariables,
            cliVersion,
            settingsSchema,
            catalog,
          })
          if (isErrored(uploadResult)) {
            printUploadError(uploadResult)
          }
        },

        async (error) => {
          haveBundlingErrors = true
          if (error.code === 'BUILD_JAVASCRIPT_ERROR') {
            notifyJsErrors(error)
            const { errors, warnings } = error
            errors?.forEach((error) => printJsError(error, 'error'))
            warnings?.forEach((warning) => printJsError(warning, 'warning'))
          } else {
            printBuildContextError(error)
          }
        }
      )
      cleanupFunctions.push(cleanupJs)
      printMessage('\n👀 Watching for changes...')
      process.on('SIGINT', async () => {
        await cleanup()
        process.exit(0)
      })
      process.on('SIGTERM', async () => {
        await cleanup()
        process.exit(0)
      })
      process.on('uncaughtException', async (error) => {
        process.stderr.write(chalk.red(`Uncaught exception: ${error}\n`))
        await cleanup()
        process.exit(1)
      })
      process.on('unhandledRejection', async (error) => {
        process.stderr.write(chalk.red(`Unhandled rejection: ${error}\n`))
        await cleanup()
        process.exit(1)
      })
      await new Promise(() => {})
    } catch (error) {
      process.stderr.write(chalk.red(`✖ ${error}\n`))
      await cleanup()
      process.exit(1)
    }
  })
