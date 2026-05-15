import { complete, errored, isErrored } from '../../../errors.js'
import {
  type AiToolCatalogPayload,
  compileAndExtractAiTools,
} from '../../../util/compile-and-extract-ai-tools.js'
import { compileAndExtractSettingsSchema } from '../../../util/compile-and-extract-settings.js'
import type { SettingsSchema } from '../../../util/extract-settings-schema.js'
import { prepareBuildContext } from '../../dev/prepare-build-context.js'

/**
 * Bundle result with client/server bundles and optional settings schema
 */
export type BundleResult = {
  bundles: [string, string]
  settingsSchema?: SettingsSchema
  aiTools?: AiToolCatalogPayload
}

export async function bundleJavaScript() {
  const buildContextResult = await prepareBuildContext('in-memory')
  if (isErrored(buildContextResult)) {
    return errored({
      code: 'ERROR_PREPARING_BUILD_CONTEXT',
      error: buildContextResult.error,
    })
  }
  const buildContext = buildContextResult.value
  const results = await buildContext.rebuild()
  if (isErrored(results)) {
    return errored({
      code: 'ERROR_BUILDING_BUNDLE',
      error: results.error,
    })
  }
  const builds = results.value
  const disposeResult = await buildContext.dispose(1_000)
  if (isErrored(disposeResult)) {
    return errored({
      code: 'ERROR_DISPOSING_BUILD_CONTEXT',
      error: disposeResult.error,
    })
  }

  // Extract settings schema after successful build
  const settingsSchema = await compileAndExtractSettingsSchema()

  // Extract AI tool catalog (publish-time materialization — plans/kopilot/apps/README.md §5)
  const aiToolsResult = await compileAndExtractAiTools()
  const aiTools = isErrored(aiToolsResult) ? undefined : aiToolsResult.value

  return complete({
    bundles: [builds.client.outputFiles[0].text, builds.server.outputFiles[0].text],
    settingsSchema,
    aiTools,
  })
}
