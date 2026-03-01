// packages/sdk/src/commands/version/list.ts

import chalk from 'chalk'
import Table from 'cli-table3'
import { Command } from 'commander'
import { format as formatDate } from 'date-fns'
import { api } from '../../api/api.js'
import { authenticator } from '../../auth/auth.js'
import { isErrored } from '../../errors.js'
import { printFetcherError, printPackageJsonError } from '../../print-errors.js'
import { getAppInfo } from '../../spinners/get-app-info.spinner.js'
import { getAppSlugFromPackageJson } from '../../spinners/get-app-slug-from-package-json.js'
import { spinnerify } from '../../util/spinner.js'

export const versionList = new Command()
  .name('list')
  .description('List all production deployments of your app')
  .action(async () => {
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
    const appInfo = appInfoResult.value
    const deploymentsResult = await spinnerify(
      'Loading deployments...',
      'Deployments loaded',
      async () => await api.listDeployments({ appId: appInfo.id, type: 'production' })
    )
    if (isErrored(deploymentsResult)) {
      printFetcherError('Error loading deployments', deploymentsResult.error)
      process.exit(1)
    }
    const deployments = deploymentsResult.value
    if (deployments.length === 0) {
      process.stdout.write('No deployments found\n')
      process.exit(0)
    }

    const statusColors: Record<string, (text: string) => string> = {
      active: chalk.green,
      'pending-review': chalk.yellow,
      'in-review': chalk.yellow,
      approved: chalk.cyan,
      published: chalk.green,
      rejected: chalk.red,
      withdrawn: chalk.gray,
      deprecated: chalk.gray,
    }

    const table = new Table({
      head: ['Version', 'Status', 'Bundles', 'Created'].map((h) => chalk.bold(h)),
      style: {
        head: [],
        border: [],
      },
      colAligns: ['center', 'left', 'left', 'left'],
    })
    deployments.forEach((d) => {
      const formattedStatus = d.status
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
      const colorFn = statusColors[d.status] ?? chalk.white
      table.push([
        d.version ?? d.id.slice(0, 8),
        colorFn(formattedStatus),
        d.clientBundleSha.slice(0, 8),
        formatDate(new Date(d.createdAt), 'MMM d, yyyy, HH:mm'),
      ])
    })
    process.stdout.write('\n' + table.toString() + '\n')
    process.exit(0)
  })
