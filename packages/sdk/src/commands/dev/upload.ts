import chalk from 'chalk'
import notifier from 'node-notifier'
import { api } from '../../api/api.js'
import { combineAsync, complete, isErrored } from '../../errors.js'
import { calculateBundleShas } from '../../util/calculate-bundle-sha.js'
import type { SettingsSchema } from '../../util/extract-settings-schema.js'
import { spinnerify } from '../../util/spinner.js'
import { uploadBundle } from '../../util/upload-bundle.js'

export async function upload({
  contents,
  versionId,
  bundleId,
  clientBundleUploadUrl,
  serverBundleUploadUrl,
  appId,
  settingsSchema,
}: {
  contents: any
  versionId: string
  bundleId: string
  clientBundleUploadUrl: string
  serverBundleUploadUrl: string
  appId: string
  settingsSchema?: SettingsSchema
}) {
  return await spinnerify(
    'Uploading...',
    () => `Upload complete at ${new Date().toLocaleTimeString()}`,
    async () => {
      const [clientBundle, serverBundle] = contents

      // Calculate combined SHA before upload
      const bundleSha = calculateBundleShas(clientBundle, serverBundle)

      const uploadResults = await combineAsync([
        uploadBundle(clientBundle, clientBundleUploadUrl),
        uploadBundle(serverBundle, serverBundleUploadUrl),
      ])
      if (isErrored(uploadResults)) {
        return uploadResults
      }

      // Log success if settings schema is included
      if (settingsSchema) {
        process.stdout.write(`${chalk.green('✓ ')}Settings schema included\n`)
      }

      // Include SHA and settings schema in completion request
      const completeBundleUploadResult = await api.completeBundleUpload({
        appId,
        versionId,
        bundleId,
        bundleSha,
        settingsSchema,
      })
      if (isErrored(completeBundleUploadResult)) {
        return completeBundleUploadResult
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
