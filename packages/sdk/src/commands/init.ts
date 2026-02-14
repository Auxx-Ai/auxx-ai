// packages/sdk/src/commands/init.ts

import boxen from 'boxen'
import chalk from 'chalk'
import { Argument, Command } from 'commander'
import { z } from 'zod'
import { api } from '../api/api.js'
import { authenticator } from '../auth/auth.js'
import { isErrored } from '../errors.js'
import { isError } from '../types/result.js'
import { printLogo } from '../util/print-logo.js'
import { createProject } from './init/create-project.js'

/**
 * Schema for slug validation
 * Must contain only lowercase letters, numbers, and hyphens
 */
const argsSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/, 'App slug must contain only lowercase letters, numbers, and hyphens')

/**
 * Initialize command - creates a new Auxx app project
 */
export const init = new Command('init')
  .description('Initialize a new Auxx app')
  .addArgument(new Argument('<app-slug>', 'The app slug, chosen in the developer dashboard'))
  .action(async (unparsedArgs: unknown) => {
    try {
      // Display logo
      printLogo()

      // Validate and parse slug
      const appSlug = argsSchema.parse(unparsedArgs)

      // Ensure user is authenticated
      const authResult = await authenticator.ensureAuthed()
      if (isError(authResult)) {
        process.stderr.write(chalk.red("✖ Authentication failed. Please run 'auxx login' first.\n"))
        process.exit(1)
      }

      // Fetch app info from API
      process.stdout.write(chalk.dim('Fetching app information...\n'))
      const appInfoResult = await api.fetchAppInfo(appSlug)

      if (isErrored(appInfoResult)) {
        if (appInfoResult.error.code === 'FETCH_APP_INFO_ERROR') {
          const fetchError = appInfoResult.error.error
          if (fetchError.code === 'HTTP_ERROR' && fetchError.status === 404) {
            process.stderr.write(
              chalk.red(
                `✖ App with slug "${appSlug}" not found.\n` +
                  `  Please create the app in your developer dashboard first.\n`
              )
            )
          } else {
            process.stderr.write(chalk.red('✖ Failed to fetch app info\n'))
          }
        }
        process.exit(1)
      }

      const appInfo = appInfoResult.value

      // Create project
      const result = await createProject({
        appSlug,
        appInfo,
      })

      if (isErrored(result)) {
        switch (result.error.code) {
          case 'DIRECTORY_ALREADY_EXISTS':
            process.stderr.write(
              chalk.red(
                `✖ Directory "${appSlug}" already exists.\n` +
                  `  Please choose a different name or remove the existing directory.\n`
              )
            )
            break
          case 'WRITE_ACCESS_DENIED':
            process.stderr.write(
              chalk.red(`✖ Permission denied: Cannot create directory in ${result.error.path}\n`)
            )
            break
          case 'COPY_ERROR':
            process.stderr.write(
              chalk.red(`✖ Failed to copy template files: ${result.error.error.message}\n`)
            )
            break
          default:
            process.stderr.write(chalk.red('✖ Failed to create project\n'))
        }
        process.exit(1)
      }

      // Success message
      process.stdout.write('\n')
      process.stdout.write(chalk.green.bold('✓ SUCCESS! Your Auxx app has been created.\n\n'))

      // Display next steps in a box
      const nextSteps = boxen(chalk.white(`cd ${appSlug}\n` + `pnpm install\n` + `pnpm run dev`), {
        padding: 1,
        margin: { top: 0, bottom: 1, left: 2, right: 0 },
        borderStyle: 'round',
        borderColor: 'green',
        title: 'Next Steps',
        titleAlignment: 'center',
      })

      process.stdout.write(nextSteps)
      process.stdout.write('\n')
      process.stdout.write(
        chalk.dim(
          `  (You can also use ${chalk.yellow('npm')}, ${chalk.yellow('yarn')}, or ${chalk.yellow('bun')})\n`
        )
      )
      process.stdout.write('\n')

      process.exit(0)
    } catch (error) {
      if (error instanceof z.ZodError) {
        process.stderr.write(chalk.red(`✖ Invalid app slug: ${error.errors[0]?.message}\n`))
      } else {
        process.stderr.write(chalk.red(`✖ ${error}\n`))
      }
      process.exit(1)
    }
  })
