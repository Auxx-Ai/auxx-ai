// packages/sdk/src/commands/login.ts

import { Command } from 'commander'
import chalk from 'chalk'
import { authenticator } from '../auth/auth.js'
import { isError } from '../types/result.js'

/**
 * Login command - authenticates the developer with Auxx
 */
export const login = new Command('login').description('Log in to Auxx').action(async () => {
  try {
    const result = await authenticator.authenticate()

    if (isError(result)) {
      const errorMessage =
        result.error.code === 'USER_CANCELLED'
          ? 'Login cancelled by user'
          : `Login failed: ${result.error.code}`

      process.stderr.write(chalk.red(`✖ ${errorMessage}\n`))
      process.exit(1)
    }

    process.stdout.write(chalk.green('✓ Successfully logged in!\n'))
    process.exit(0)
  } catch (error) {
    process.stderr.write(chalk.red(`✖ ${error}\n`))
    process.exit(1)
  }
})
