// packages/sdk/src/commands/version/create/bundle-javascript.ts

import { complete, errored, isErrored } from '../../../errors.js'
import {
  type CatalogPayload,
  compileAndExtractCatalog,
} from '../../../util/compile-and-extract-catalog.js'
import { compileAndExtractSettingsSchema } from '../../../util/compile-and-extract-settings.js'
import type { SettingsSchema } from '../../../util/extract-settings-schema.js'
import { prepareBuildContext } from '../../dev/prepare-build-context.js'

/**
 * Bundle result with client/server bundles, optional settings schema, and the
 * publish-time catalog payload (`agent.tools`, `actions`, `workflow.blocks`,
 * `triggers`, …) read directly by every consumer.
 */
export type BundleResult = {
  bundles: [string, string]
  settingsSchema?: SettingsSchema
  catalog?: CatalogPayload
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

  // Extract surface catalog (publish-time materialization — see
  // plans/kopilot/agents/triggers/app-surface-implementation-plan.md §5.3).
  const catalogResult = await compileAndExtractCatalog()
  const catalog = isErrored(catalogResult) ? undefined : catalogResult.value

  return complete({
    bundles: [builds.client.outputFiles[0].text, builds.server.outputFiles[0].text],
    settingsSchema,
    catalog,
  })
}
