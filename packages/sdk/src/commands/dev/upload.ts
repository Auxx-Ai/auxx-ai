// packages/sdk/src/commands/dev/upload.ts

import chalk from 'chalk'
import notifier from 'node-notifier'
import { api } from '../../api/api.js'
import { combineAsync, complete, isErrored } from '../../errors.js'
import { calculateBundleSha } from '../../util/calculate-bundle-sha.js'
import type { SettingsSchema } from '../../util/extract-settings-schema.js'
import { spinnerify } from '../../util/spinner.js'
import { uploadBundle } from '../../util/upload-bundle.js'

export async function upload({
  contents,
  appId,
  targetOrganizationId,
  environmentVariables,
  cliVersion,
  settingsSchema,
}: {
  contents: any
  appId: string
  targetOrganizationId: string
  environmentVariables: Record<string, string>
  cliVersion: string
  settingsSchema?: SettingsSchema
}) {
  return await spinnerify(
    'Uploading...',
    () => `Upload complete at ${new Date().toLocaleTimeString()}`,
    async () => {
      const [clientBundle, serverBundle] = contents

      // 1. Compute individual SHAs
      const clientSha = calculateBundleSha(clientBundle)
      const serverSha = calculateBundleSha(serverBundle)

      // 2. Check which bundles already exist
      const checkResult = await api.checkBundles({ appId, clientSha, serverSha })
      if (isErrored(checkResult)) {
        return checkResult
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
        const uploadResults = await combineAsync(uploads)
        if (isErrored(uploadResults)) {
          return uploadResults
        }
      }

      // 4. Confirm upload
      const confirmResult = await api.confirmBundles({ appId, clientSha, serverSha })
      if (isErrored(confirmResult)) {
        return confirmResult
      }

      // Log success if settings schema is included
      if (settingsSchema) {
        process.stdout.write(`${chalk.green('✓ ')}Settings schema included\n`)
      }

      // 5. Create deployment
      const deployResult = await api.createDeployment({
        appId,
        clientBundleSha: clientSha,
        serverBundleSha: serverSha,
        deploymentType: 'development',
        targetOrganizationId,
        environmentVariables,
        settingsSchema,
        metadata: { cliVersion },
      })
      if (isErrored(deployResult)) {
        return deployResult
      }

      try {
        notifier.notify({
          title: 'Upload Complete',
          message: 'New bundle uploaded to Auxx',
        })
      } catch {}
      return complete(undefined)
    }
  )
}
