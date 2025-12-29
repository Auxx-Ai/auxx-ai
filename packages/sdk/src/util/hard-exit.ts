// packages/sdk/src/util/hard-exit.ts

import chalk from 'chalk'

/**
 * Exit the process with an error message
 * @param message - The error message to display
 */
export function hardExit(message: string): never {
  process.stderr.write(chalk.red(`✖ ${message}\n`))
  process.exit(1)
}
