// import readline from 'node:readline/promises'
import chalk from 'chalk'
import { Command, Option } from 'commander'
import { z } from 'zod'
import { authenticator } from '../auth/auth.js'
import {
  printDetermineOrganizationError,
  printFetcherError,
  printLogSubscriptionError,
  printPackageJsonError,
} from '../print-errors.js'
import { determineOrganization } from '../spinners/determine-organization.spinner.js'
import { getAppInfo } from '../spinners/get-app-info.spinner.js'
import { getAppSlugFromPackageJson } from '../spinners/get-app-slug-from-package-json.js'
import { spinnerify } from '../util/spinner.js'
import { subscribeToLogs } from './logs/subscribe-to-logs.js'
import { isErrored } from '../errors.js'

export const optionsSchema = z.object({
  organization: z.string().optional(),
})

// const rl = readline.createInterface({
//   input: process.stdin,
//   output: process.stdout,
// })
// async function waitForEnter(prompt = 'Press Enter to resume...') {
//   await rl.question(prompt)
// }
export const logs = new Command('logs')
  .description('Stream development server logs')
  .addOption(
    new Option('-o, --organization <slug>', 'The handle of the organization to get the logs from')
  )
  .action(async (unparsedOptions) => {
    const { organization: organizationHandle } = optionsSchema.parse(unparsedOptions)
    await authenticator.ensureAuthed()

    const appSlugResult = await getAppSlugFromPackageJson()
    if (isErrored(appSlugResult)) {
      printPackageJsonError(appSlugResult)
      process.exit(1)
    }
    const appSlug = appSlugResult.value
    const appInfoResult = await getAppInfo(appSlug)

    if (isErrored(appInfoResult)) {
      printFetcherError('Error loading app info', appInfoResult.error)
      process.exit(1)
    }
    const organizationResult = await determineOrganization(organizationHandle)

    if (isErrored(organizationResult)) {
      printDetermineOrganizationError(organizationResult.error)
      process.exit(1)
    }
    const organization = organizationResult.value

    const subscriptionResult = await spinnerify(
      'Starting log polling...',
      'Polling logs',
      async () => {
        return subscribeToLogs(
          { organizationHandle: organization.handle, appSlug },
          ({ message, severity, timestamp }) => {
            let coloredSeverity
            switch (severity) {
              case 'INFO':
                coloredSeverity = chalk.blue(severity)
                break
              case 'ERROR':
                coloredSeverity = chalk.red(severity)
                break
              case 'WARNING':
                coloredSeverity = chalk.yellow(severity)
                break
              default:
                coloredSeverity = severity
            }
            const logLine = `${timestamp} ${coloredSeverity}: ${message.trim()}`
            process.stdout.write(`\n${logLine}`)
          }
        )
      }
    )
    if (isErrored(subscriptionResult)) {
      printLogSubscriptionError(subscriptionResult.error)
      process.exit(2)
    }
    let isShuttingDown = false
    const shutdown = async (exitCode = 0) => {
      if (isShuttingDown) {
        return
      }
      isShuttingDown = true
      try {
        await subscriptionResult.value.unsubscribe()
      } catch {
        exitCode = Math.min(exitCode, 1)
      } finally {
        process.exit(exitCode)
      }
    }
    ;['SIGINT', 'SIGTERM'].forEach((signal) => process.on(signal, async () => shutdown(0)))
    process.on('beforeExit', async (exitCode) => {
      await shutdown(exitCode)
    })
    process.on('uncaughtException', async (error) => {
      process.stderr.write(chalk.red(`Uncaught exception: ${error}\n`))
      await shutdown(1)
    })
    process.on('unhandledRejection', async (error) => {
      process.stderr.write(chalk.red(`Unhandled rejection: ${error}\n`))
      await shutdown(1)
    })
    await new Promise(() => {})
  })
