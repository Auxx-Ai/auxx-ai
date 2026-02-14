import chalk from 'chalk'
import Table from 'cli-table3'
import { Command } from 'commander'
import { format as formatDate } from 'date-fns'
import { authenticator } from '../../auth/auth.js'
import { isErrored } from '../../errors.js'
import { printFetcherError, printPackageJsonError } from '../../print-errors.js'
import { getAppInfo } from '../../spinners/get-app-info.spinner.js'
import { getAppSlugFromPackageJson } from '../../spinners/get-app-slug-from-package-json.js'
import { getVersions } from '../../spinners/get-versions.spinner.js'

export const versionList = new Command()
  .name('list')
  .description('List all versions of your app')
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
    const versionsResult = await getVersions(appInfo)
    if (isErrored(versionsResult)) {
      printFetcherError('Error loading versions', versionsResult.error)
      process.exit(1)
    }
    const versions = versionsResult.value
    if (versions.length === 0) {
      process.stdout.write('No versions found\n')
      process.exit(0)
    }
    const table = new Table({
      head: ['Version', 'Status', 'Published', 'Installations', 'Created'].map((h) =>
        chalk.bold(h)
      ),
      style: {
        head: [],
        border: [],
      },
      colAligns: ['center', 'left', 'center', 'right', 'left'],
    })
    versions.forEach((version) => {
      const statusColors = {
        private: chalk.gray,
        'in-review': chalk.yellow,
        published: chalk.green,
        rejected: chalk.red,
        unpublished: chalk.gray,
      }
      const formattedStatus = version.publication_status
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
      table.push([
        `${version.major}.${version.minor}`,
        statusColors[version.publication_status](formattedStatus),
        version.is_published ? 'Yes' : 'No',
        version.num_installations.toLocaleString(),
        formatDate(new Date(version.created_at), 'MMM d, yyyy, HH:mm'),
      ])
    })
    process.stdout.write('\n' + table.toString() + '\n')
    process.exit(0)
  })
