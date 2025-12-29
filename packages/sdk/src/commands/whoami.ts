// packages/sdk/src/commands/whoami.ts

import { Command } from 'commander'
import chalk from 'chalk'
import Table from 'cli-table3'
import { authenticator } from '../auth/auth.js'
import { api } from '../api/api.js'
import { isErrored } from '../errors.js'
import { isError } from '../types/result.js'

/**
 * Whoami command - displays current authenticated user information
 */
export const whoami = new Command('whoami')
  .description('Show current user information')
  .action(async () => {
    try {
      const authResult = await authenticator.ensureAuthed()

      if (isError(authResult)) {
        process.stderr.write(chalk.red('✖ Not logged in\n'))
        process.stderr.write(chalk.yellow('Run "auxx login" to authenticate\n'))
        process.exit(1)
      }

      const userResult = await api.getUserInfo()

      if (isErrored(userResult)) {
        process.stderr.write(chalk.red(`✖ Failed to fetch user info\n`))
        process.exit(1)
      }

      const user = userResult.value

      const table = new Table()
      table.push({ 'User ID': user.sub }, { Email: user.email }, { Name: user.name || 'Not set' })

      console.log(table.toString())
      process.exit(0)
    } catch (error) {
      process.stderr.write(chalk.red(`✖ ${error}\n`))
      process.exit(1)
    }
  })
