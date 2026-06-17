// packages/lib/src/quick-actions/resolve-options.ts

import type { DynamicSelectHint } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { RecordId } from '@auxx/types/resource'
import { resolveAppFieldValue } from '../agents/bindings'
import { getCachedInstalledApps } from '../cache/org-cache-helpers'

const logger = createScopedLogger('quick-action-resolve-options')

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

export interface QuickActionOption {
  value: string
  label: string
  sublabel?: string
}

export interface ResolveQuickActionOptionsResult {
  options: QuickActionOption[]
  /** Hint shown disabled when no options resolve; null when there are options. */
  disabledHint: string | null
}

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

  // 4. Invoke the resolver tool in the lambda — mirror QuickActionExecutor.
  const { getInstallationDeployment } = await import(
    '../apps/installations/get-installation-deployment'
  )
  const { prepareLambdaContext, invokeLambdaExecutor } = await import('../apps/lambda')

  const installationResult = await getInstallationDeployment({
    installationId: input.installationId,
    organizationHandle: input.organizationHandle,
    appId: input.appId,
  })
  if (installationResult.isErr()) {
    logger.warn('Failed to get installation deployment', {
      installationId: input.installationId,
      error: installationResult.error.message,
    })
    return disabled()
  }
  const { serverBundleSha, installation: inst } = installationResult.value
  if (!serverBundleSha) return disabled()

  const baseContext = prepareLambdaContext({
    appId: input.appId,
    installationId: inst.id,
    organizationId: input.organizationId,
    organizationHandle: input.organizationHandle,
    userId: input.userId,
    userEmail: input.userEmail,
    userName: input.userName,
    userConnection,
    organizationConnection,
  })

  const lambdaResult = await invokeLambdaExecutor({
    caller: 'quick-action',
    payload: {
      type: 'tool',
      serverBundleSha,
      toolId: ds.optionsFrom,
      inputs: { ...ds.args, ...boundArgs },
      context: baseContext,
      invocationContext: { kind: 'action', recordId: input.recordId },
      timeout: 30000,
    },
  })
  if (lambdaResult.isErr()) {
    logger.warn('Resolver lambda invocation failed', {
      optionsFrom: ds.optionsFrom,
      error: lambdaResult.error.message,
    })
    return disabled()
  }
  const result = lambdaResult.value
  if (result.metadata?.runtime_error || result.metadata?.validation_error) {
    return disabled()
  }
  const data = result.execution_result?.data ?? result.execution_result ?? {}

  // 5. Map output → options, then local-filter by query.
  return mapResolverOutputToOptions(data, ds, input.query)
}

/**
 * Pure mapping from a resolver tool's raw output to the option list — the
 * testable core of step 5. Selects items at `itemsPath`, projects each via
 * `valuePath`/`labelTemplate`/`sublabelTemplate`, drops valueless rows, and
 * locally filters by `query`.
 */
export function mapResolverOutputToOptions(
  data: unknown,
  ds: DynamicSelectHint,
  query?: string
): ResolveQuickActionOptionsResult {
  const items = selectItems(data, ds.itemsPath)
  const options: QuickActionOption[] = []
  for (const item of items) {
    const value = getPath(item, ds.valuePath)
    if (value === undefined || value === null || value === '') continue
    options.push({
      value: String(value),
      label: renderTemplate(ds.labelTemplate, item) || String(value),
      sublabel: ds.sublabelTemplate ? renderTemplate(ds.sublabelTemplate, item) : undefined,
    })
  }

  const filtered = filterOptions(options, query)
  return { options: filtered, disabledHint: filtered.length ? null : (ds.emptyHint ?? null) }
}

/** Pull the option array out of the resolver output via `itemsPath`, else the first array found. */
function selectItems(data: unknown, itemsPath?: string): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>
  if (itemsPath) {
    const at = getPath(data, itemsPath)
    return Array.isArray(at) ? (at as Array<Record<string, unknown>>) : []
  }
  // No itemsPath and not an array — take the first array-valued top-level field.
  if (data && typeof data === 'object') {
    for (const value of Object.values(data as Record<string, unknown>)) {
      if (Array.isArray(value)) return value as Array<Record<string, unknown>>
    }
  }
  return []
}

/** Read a dotted path (`a.b.c`) off an object. */
function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
    return undefined
  }, obj)
}

/** Substitute `{field}` / `{a.b}` placeholders in a template from an item. */
function renderTemplate(template: string, item: Record<string, unknown>): string {
  return template
    .replace(/\{([^}]+)\}/g, (_, key: string) => {
      const value = getPath(item, key.trim())
      return value === undefined || value === null ? '' : String(value)
    })
    .trim()
}

/** Case-insensitive substring filter over value + label + sublabel. */
function filterOptions(options: QuickActionOption[], query?: string): QuickActionOption[] {
  const q = query?.trim().toLowerCase()
  if (!q) return options
  return options.filter((o) =>
    `${o.value} ${o.label} ${o.sublabel ?? ''}`.toLowerCase().includes(q)
  )
}
