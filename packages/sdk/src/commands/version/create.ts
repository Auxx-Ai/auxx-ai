// packages/sdk/src/commands/version/create.ts

import chalk from 'chalk'
import { Command } from 'commander'
import { api } from '../../api/api.js'
import { authenticator } from '../../auth/auth.js'
import { USE_APP_TS, USE_SETTINGS } from '../../env.js'
import { combineAsync, isErrored } from '../../errors.js'
import {
  printCliVersionError,
  printFetcherError,
  printPackageJsonError,
} from '../../print-errors.js'
import { getAppInfo } from '../../spinners/get-app-info.spinner.js'
import { getAppSlugFromPackageJson } from '../../spinners/get-app-slug-from-package-json.js'
import { assertAppSettings } from '../../util/assert-app-settings.js'
import { calculateBundleSha } from '../../util/calculate-bundle-sha.js'
import { ensureAppEntryPoint } from '../../util/ensure-app-entry-point.js'
import { exitWithMissingAppSettings } from '../../util/exit-with-missing-app-settings.js'
import { exitWithMissingEntryPoint } from '../../util/exit-with-missing-entry-point.js'
import { loadAuxxCliVersion } from '../../util/load-auxx-cli-version.js'
import { spinnerify } from '../../util/spinner.js'
import { printJsError } from '../../util/typescript.js'
import { uploadBundle } from '../../util/upload-bundle.js'
import { printBuildContextError } from '../dev/prepare-build-context.js'
import { bundleJavaScript } from './create/bundle-javascript.js'

export const versionCreate = new Command('create')
  .description('Create a new deployment of your auxx app')
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

    const deployResult = await spinnerify('Uploading...', 'Upload complete', async () => {
      const cliVersionResult = loadAuxxCliVersion()
      if (isErrored(cliVersionResult)) {
        printCliVersionError(cliVersionResult)
        process.exit(1)
      }
      const cliVersion = cliVersionResult.value

      // 1. Compute individual SHAs
      const clientSha = calculateBundleSha(clientBundle)
      const serverSha = calculateBundleSha(serverBundle)

      // 2. Check which bundles already exist
      const checkResult = await api.checkBundles({ appId: appInfo.id, clientSha, serverSha })
      if (isErrored(checkResult)) {
        printFetcherError('Error checking bundles', checkResult)
        process.exit(1)
      }

      // 3. Upload only missing bundles
      const uploads = []
      if (!checkResult.value.client.exists) {
        uploads.push(uploadBundle(clientBundle, checkResult.value.client.uploadUrl!))
      }
      if (!checkResult.value.server.exists) {
        uploads.push(uploadBundle(serverBundle, checkResult.value.server.uploadUrl!))
      }
      if (uploads.length > 0) {
        const uploadResult = await combineAsync(uploads)
        if (isErrored(uploadResult)) {
          process.stderr.write(`${chalk.red('✖ ')}Failed to upload bundle\n`)
          process.exit(1)
        }
      }

      // 4. Confirm upload
      const confirmResult = await api.confirmBundles({
        appId: appInfo.id,
        clientSha,
        serverSha,
      })
      if (isErrored(confirmResult)) {
        printFetcherError('Error confirming bundles', confirmResult)
        process.exit(1)
      }

      // 5. Create production deployment
      const result = await api.createDeployment({
        appId: appInfo.id,
        clientBundleSha: clientSha,
        serverBundleSha: serverSha,
        deploymentType: 'production',
        settingsSchema,
        metadata: { cliVersion },
      })
      if (isErrored(result)) {
        printFetcherError('Error creating deployment', result)
        process.exit(1)
      }

      return result
    })

    if (isErrored(deployResult)) {
      process.stderr.write(`${chalk.red('✖ ')}Failed to create deployment: ${deployResult.error}\n`)
      process.exit(1)
    }

    const deployment = deployResult.value
    process.stdout.write(
      `\nDeployment ${chalk.green(deployment.version ?? deployment.deploymentId)} created!\n\n`
    )
    process.exit(0)
  })
