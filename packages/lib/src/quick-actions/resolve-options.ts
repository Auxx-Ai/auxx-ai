// packages/lib/src/quick-actions/resolve-options.ts

import type { DynamicSelectHint } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
import { resolveAppFieldValue } from '../agents/bindings'
import {
  invokeAppToolForOptions,
  mapToolOutputToOptions,
  type ResolveToolOptionsResult,
  type ToolOption,
} from '../apps/tool-options'
import { getCachedInstalledApps } from '../cache/org-cache-helpers'

/**
 * Back-compat re-export — the pure output→options mapper now lives in the
 * generic app-tool-options core (shared with the data-connector config picker).
 */
export const mapResolverOutputToOptions = mapToolOutputToOptions

/** Input for {@link resolveQuickActionOptions}. */
export interface ResolveQuickActionOptionsInput {
  appId: string
  installationId: string
  /** The action tool id — used to look up its `inputHints`. */
  actionId: string
  /** Which dynamic-select input on the action. */
  fieldKey: string
  /** The subject record to bind against (`<entityDefId>:<entityInstanceId>`). */
  recordId: string
  /** Search term — filters the resolved list locally (never sent to the resolver). */
  query?: string
  organizationId: string
  organizationHandle: string
  userId: string
  userEmail: string
  userName: string
}

export type QuickActionOption = ToolOption
export type ResolveQuickActionOptionsResult = ResolveToolOptionsResult

/**
 * Resolve the live options for a quick-action `dynamic-select` input. Runs the
 * app's resolver tool (`dynamicSelect.optionsFrom`) in the lambda, scoped to the
 * thread's contact, and shapes its output into selectable options.
 *
 * Read-only: the resolver tool should be `idempotent`. Mirrors
 * {@link QuickActionExecutor.execute}'s lambda plumbing but invokes the resolver
 * and maps its output. See plans/actions/09-dynamic-action-inputs.md §6.
 */
export async function resolveQuickActionOptions(
  input: ResolveQuickActionOptionsInput
): Promise<ResolveQuickActionOptionsResult> {
  // 1. Look up the dynamic-select hint from the org cache.
  const installedApps = await getCachedInstalledApps(input.organizationId)
  const installation = installedApps.find((a) => a.installationId === input.installationId)
  const action = installation?.actions?.find((a) => a.toolId === input.actionId)
  const hint = action?.inputHints?.[input.fieldKey]
  if (!hint || hint.kind !== 'dynamic-select') {
    throw new Error(
      `No dynamic-select hint for action "${input.actionId}" input "${input.fieldKey}"`
    )
  }
  const ds: DynamicSelectHint = hint.dynamicSelect
  const disabled = (): ResolveQuickActionOptionsResult => ({
    options: [],
    disabledHint: ds.emptyHint ?? null,
  })

  // 2. Resolve the workspace (org) connection credId — reuse the executor path.
  //    The same credId drives both the field read (step 3) and the lambda call
  //    (step 4), so they can't drift to different accounts.
  const { resolveAppConnectionForRuntime } = await import(
    '../apps/connections/resolve-app-connection-for-runtime'
  )
  const connectionsResult = await resolveAppConnectionForRuntime({
    appId: input.appId,
    organizationId: input.organizationId,
    userId: input.userId,
  })
  if (connectionsResult.isErr()) return disabled()
  const { userConnection, organizationConnection } = connectionsResult.value
  const connId = organizationConnection?.id ?? userConnection?.id
  if (!connId) return disabled()

  // 3. Resolve each bound arg off the record via the shared helper. An empty
  //    bound value (e.g. no Stripe customer linked) → disabled/empty state.
  const boundArgs: Record<string, unknown> = {}
  for (const [argName, ref] of Object.entries(ds.bindArgsFrom ?? {})) {
    const value = await resolveAppFieldValue({
      orgId: input.organizationId,
      recordId: input.recordId as RecordId,
      ref,
      connectionId: connId,
    })
    if (value === undefined || value === null || value === '') return disabled()
    boundArgs[argName] = value
  }

  // 4-5. Invoke the resolver tool + map its output via the shared core.
  return invokeAppToolForOptions({
    appId: input.appId,
    installationId: input.installationId,
    organizationId: input.organizationId,
    organizationHandle: input.organizationHandle,
    userId: input.userId,
    userEmail: input.userEmail,
    userName: input.userName,
    userConnection,
    organizationConnection,
    hint: ds,
    boundArgs,
    invocationContext: { kind: 'action', recordId: input.recordId },
    query: input.query,
  })
}
