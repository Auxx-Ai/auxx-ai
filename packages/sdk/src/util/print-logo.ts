// packages/sdk/src/util/print-logo.ts

import chalk from 'chalk'
import { AUXX_LOGO } from '../auxx-logo.js'

/**
 * Print the Auxx logo to console
 */
export function printLogo(): void {
  console.log(chalk.blue(AUXX_LOGO))
}
