import chalk from 'chalk'
import { Command } from 'commander'
import { combineAsync, isErrored } from '../../errors.js'
import { api } from '../../api/api.js'
import { authenticator } from '../../auth/auth.js'
import { USE_APP_TS, USE_SETTINGS } from '../../env.js'
import {
  printCliVersionError,
  printFetcherError,
  printPackageJsonError,
} from '../../print-errors.js'
import { getAppInfo } from '../../spinners/get-app-info.spinner.js'
import { getAppSlugFromPackageJson } from '../../spinners/get-app-slug-from-package-json.js'
import { getVersions } from '../../spinners/get-versions.spinner.js'
import { ensureAppEntryPoint } from '../../util/ensure-app-entry-point.js'
import { assertAppSettings } from '../../util/assert-app-settings.js'
import { loadAuxxCliVersion } from '../../util/load-auxx-cli-version.js'
import { spinnerify } from '../../util/spinner.js'
import { printJsError } from '../../util/typescript.js'
import { uploadBundle } from '../../util/upload-bundle.js'
import { printBuildContextError } from '../dev/prepare-build-context.js'
import { bundleJavaScript } from './create/bundle-javascript.js'
import { exitWithMissingAppSettings } from '../../util/exit-with-missing-app-settings.js'
import { exitWithMissingEntryPoint } from '../../util/exit-with-missing-entry-point.js'
import { calculateBundleShas } from '../../util/calculate-bundle-sha.js'

export const versionCreate = new Command('create')
  .description('Create a new unpublished version of your auxx app')
  .action(async () => {
    if (USE_APP_TS) {
      const appEntryPointResult = await ensureAppEntryPoint()
      if (isErrored(appEntryPointResult)) {
        exitWithMissingEntryPoint()
      }
    }
    if (USE_SETTINGS) {
      const settingsResult = await assertAppSettings()
      if (isErrored(settingsResult)) {
        exitWithMissingAppSettings()
      }
    }
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
    const bundleResult = await spinnerify(
      'Bundling JavaScript...',
      'Bundling complete',
      bundleJavaScript
    )
    if (isErrored(bundleResult)) {
      if (bundleResult.error.code === 'ERROR_BUILDING_BUNDLE') {
        const { error } = bundleResult.error
        if (error.code === 'BUILD_JAVASCRIPT_ERROR') {
          const { errors, warnings } = error
          errors?.forEach((error: any) => printJsError(error, 'error'))
          warnings?.forEach((warning: any) => printJsError(warning, 'warning'))
        } else {
          printBuildContextError(error)
        }
      } else {
        printBuildContextError(bundleResult.error.error)
      }
      process.exit(1)
    }

    // Destructure bundles and settings schema from result
    const { bundles, settingsSchema } = bundleResult.value
    const [clientBundle, serverBundle] = bundles

    // Log success if settings schema is included
    if (settingsSchema) {
      process.stdout.write(`${chalk.green('✓ ')}Settings schema extracted\n`)
    }

    // Calculate combined SHA for the bundles
    const bundleSha = calculateBundleShas(clientBundle, serverBundle)

    const versionsResult = await getVersions(appInfo)
    if (isErrored(versionsResult)) {
      printFetcherError('Error fetching versions', versionsResult.error)
      process.exit(1)
    }
    const versions = versionsResult.value
    const versionResult = await spinnerify('Uploading...', 'Upload complete', async () => {
      const cliVersionResult = loadAuxxCliVersion()
      if (isErrored(cliVersionResult)) {
        printCliVersionError(cliVersionResult)
        process.exit(1)
      }
      const cliVersion = cliVersionResult.value
      const versionResult = await api.createVersion({
        appId: appInfo.id,
        major: versions.length === 0 ? 1 : Math.max(...versions.map((version) => version.major), 1),
        cliVersion,
      })

      if (isErrored(versionResult)) {
        printFetcherError('Error creating version', versionResult)
        process.exit(1)
      }

      const { bundle } = versionResult.value
      const uploadResult = await combineAsync([
        uploadBundle(clientBundle, bundle.clientBundleUploadUrl),
        uploadBundle(serverBundle, bundle.serverBundleUploadUrl),
      ])
      if (isErrored(uploadResult)) {
        process.stderr.write(
          `${chalk.red('✖ ')}Failed to upload bundle to: ${uploadResult.error.uploadUrl}\n`
        )
        process.exit(1)
      }
      return versionResult
    })
    if (isErrored(versionResult)) {
      process.stderr.write(`${chalk.red('✖ ')}Failed to create version: ${versionResult.error}\n`)
      process.exit(1)
    }
    const version = versionResult.value
    const signingResult = await spinnerify(
      'Signing bundles...',
      'Bundles signed',
      async () =>
        await api.completeProdBundleUpload({
          appId: appInfo.id,
          versionId: version.versionId,
          bundleId: version.bundle.id,
          bundleSha,
          settingsSchema,
        })
    )
    if (isErrored(signingResult)) {
      printFetcherError('Error signing bundles', signingResult.error)
      process.exit(1)
    }
    process.stdout.write(
      `\nVersion ${chalk.green(`${version.major}.${version.minor}`)} created!\n\n`
    )
    process.exit(0)
  })
