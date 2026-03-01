// packages/sdk/src/commands/dev/boot.ts

import { isErrored } from '../../errors.js'
import {
  printCliVersionError,
  printDetermineOrganizationError,
  printFetcherError,
  printPackageJsonError,
} from '../../print-errors.js'
import { determineOrganization } from '../../spinners/determine-organization.spinner.js'
import { getAppInfo } from '../../spinners/get-app-info.spinner.js'
import { getAppSlugFromPackageJson } from '../../spinners/get-app-slug-from-package-json.js'
import { loadAuxxCliVersion } from '../../util/load-auxx-cli-version.js'
import { loadEnv } from '../../util/load-env.js'

export async function boot({ organizationSlug }: { organizationSlug?: string }) {
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
  const organizationResult = await determineOrganization(organizationSlug)

  if (isErrored(organizationResult)) {
    printDetermineOrganizationError(organizationResult)
    process.exit(1)
  }
  const organization = organizationResult.value
  const environmentVariables = await loadEnv()
  const cliVersionResult = loadAuxxCliVersion()

  if (isErrored(cliVersionResult)) {
    printCliVersionError(cliVersionResult)
    process.exit(1)
  }
  const cliVersion = cliVersionResult.value

  return {
    appId: appInfo.id,
    appSlug,
    organization,
    environmentVariables,
    cliVersion,
  }
}
