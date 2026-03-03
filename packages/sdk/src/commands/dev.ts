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
import { generateAppEnvTypes } from '../util/generate-app-env-types.js'
import { generateGitignore } from '../util/generate-gitignore.js'

import { generateSettingsFiles } from '../util/generate-settings-files.js'
import { hardExit } from '../util/hard-exit.js'
import { printMessage } from '../util/print-message.js'
import { printJsError, printTsError } from '../util/typescript.js'
import { boot } from './dev/boot.js'
import { bundleJavaScript } from './dev/bundle-javascript.js'
// import { graphqlServer } from './dev/graphql-server.js'
import { onboarding } from './dev/onboarding.js'
import { printBuildContextError } from './dev/prepare-build-context.js'
import { upload } from './dev/upload.js'

import { validateTypeScript } from './dev/validate-typescript.js'

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
})
type CleanupFunction = () => void

export const dev = new Command('dev')
  .description('Develop your Auxx.ai app')
  .addOption(new Option('-o, --organization <handle>', 'The handle of the organization to use'))
  .action(async (unparsedOptions) => {
    const { organization: organizationSlug } = optionsSchema.parse(unparsedOptions)

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
      const { appId, appSlug, organization, environmentVariables, cliVersion } = await boot({
        organizationSlug,
      })

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
        async (contents, settingsSchema) => {
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
