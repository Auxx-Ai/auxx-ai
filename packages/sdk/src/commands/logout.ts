// packages/sdk/src/commands/logout.ts

import { Command } from 'commander'
import chalk from 'chalk'
import { authenticator } from '../auth/auth.js'

/**
 * Logout command - removes authentication credentials
 */
export const logout = new Command('logout').description('Log out of Auxx').action(async () => {
  try {
    await authenticator.logout()
    process.stdout.write(chalk.green('✓ Successfully logged out!\n'))
    process.exit(0)
  } catch (error) {
    process.stderr.write(chalk.red(`✖ ${error}\n`))
    process.exit(1)
  }
})
