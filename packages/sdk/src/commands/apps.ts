// packages/sdk/src/commands/apps.ts

import chalk from 'chalk'
import Table from 'cli-table3'
import { Command } from 'commander'
import { api } from '../api/api.js'
import { authenticator } from '../auth/auth.js'
import { isErrored } from '../errors.js'
import { isError } from '../types/result.js'

/**
 * Apps command - lists all apps for the authenticated developer
 */
export const apps = new Command('apps')
  .description('List all apps for the authenticated developer')
  .action(async () => {
    try {
      // Ensure user is authenticated
      const authResult = await authenticator.ensureAuthed()

      if (isError(authResult)) {
        process.stderr.write(chalk.red('✖ Not logged in\n'))
        process.stderr.write(chalk.yellow('Run "auxx login" to authenticate\n'))
        process.exit(1)
      }

      // Fetch apps from API
      process.stdout.write(chalk.dim('Fetching apps...\n'))
      const appsResult = await api.fetchApps()

      if (isErrored(appsResult)) {
        process.stderr.write(chalk.red('✖ Failed to fetch apps\n'))
        if (appsResult.error.error.code === 'HTTP_ERROR') {
          const httpError = appsResult.error.error
          if (httpError.status === 404) {
            process.stderr.write(
              chalk.yellow(
                'No developer account found. Please create one in the developer portal.\n'
              )
            )
          } else {
            process.stderr.write(chalk.dim(`Error: ${httpError.status} ${httpError.statusText}\n`))
          }
        }
        process.exit(1)
      }

      const appsList = appsResult.value

      // Check if no apps exist
      if (appsList.length === 0) {
        process.stdout.write(chalk.yellow('\nNo apps found.\n'))
        process.stdout.write(
          chalk.dim('Create your first app in the developer portal at https://build.auxx.ai\n\n')
        )
        process.exit(0)
      }

      // Display apps in table
      const table = new Table({
        head: [chalk.cyan('Slug'), chalk.cyan('Title'), chalk.cyan('Description')],
        colWidths: [30, 30, 50],
        wordWrap: true,
      })

      appsList.forEach((app) => {
        const description = app.description
          ? app.description.length > 100
            ? app.description.substring(0, 97) + '...'
            : app.description
          : chalk.dim('No description')

        table.push([app.slug, app.title, description])
      })

      process.stdout.write('\n')
      process.stdout.write(
        chalk.green.bold(`Found ${appsList.length} app${appsList.length === 1 ? '' : 's'}:\n`)
      )
      process.stdout.write(table.toString())
      process.stdout.write('\n\n')
      process.stdout.write(
        chalk.dim('Tip: Use "auxx init <app-slug>" to create a local project for an app\n')
      )
      process.stdout.write('\n')

      process.exit(0)
    } catch (error) {
      process.stderr.write(chalk.red(`✖ ${error}\n`))
      process.exit(1)
    }
  })
