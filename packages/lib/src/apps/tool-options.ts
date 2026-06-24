// packages/lib/src/apps/tool-options.ts

import type { DynamicSelectHint } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('app-tool-options')

/**
 * Generic "run an app tool, shape its output into selectable options" core.
 *
 * Both the quick-action dynamic-select resolver (scoped to a thread's contact)
 * and the data-connector config picker (scoped to a connector's connection) call
 * this with the connection + bound args already resolved by their caller-specific
 * front. The only thing this layer owns is: locate the deployment bundle, invoke
 * the resolver tool in the lambda, and map the output via {@link mapToolOutputToOptions}.
 *
 * Lazy-imports the app-runtime cluster (a static import pulls billing/dist into
 * vitest — project memory). The pure mapper below has no such deps.
 */

export interface ToolOption {
  value: string
  label: string
  sublabel?: string
}

export interface ResolveToolOptionsResult {
  options: ToolOption[]
  /** Hint shown disabled when no options resolve; null when there are options. */
  disabledHint: string | null
}

/** Identifiers + already-resolved connection/args needed to run the resolver tool. */
export interface InvokeToolForOptionsInput {
  appId: string
  installationId: string
  organizationId: string
  organizationHandle: string
  userId?: string
  userEmail?: string | null
  userName?: string | null
  /** Decrypted runtime connections (resolved by the caller-specific front). */
  userConnection?: unknown
  organizationConnection?: unknown
  /** The dynamic-select hint (`optionsFrom`, value/label paths, constant `args`). */
  hint: DynamicSelectHint
  /** Args bound from the surrounding context (empty for connector config). */
  boundArgs?: Record<string, unknown>
  /** Passed through to the sandbox for telemetry/scoping; shape is caller-defined. */
  invocationContext?: Record<string, unknown>
  /** Search term — filters the resolved list locally. */
  query?: string
}

/**
 * Locate the deployment bundle, invoke `hint.optionsFrom` in the lambda with the
 * resolved connection + args, and map its output to options. Returns the
 * disabled/empty state (never throws) on any resolution failure.
 */
export async function invokeAppToolForOptions(
  input: InvokeToolForOptionsInput
): Promise<ResolveToolOptionsResult> {
  const { hint } = input
  // No options resolved. The success-but-empty case shows the author's
  // `emptyHint`; a failure passes its own message so the field surfaces *why* it
  // couldn't load (a denied/erroring resolver) instead of looking like "no
  // results". The reason is shown verbatim in the picker placeholder.
  const disabled = (reason?: string): ResolveToolOptionsResult => ({
    options: [],
    disabledHint: reason ?? hint.emptyHint ?? null,
  })

  const { getInstallationDeployment } = await import('./installations/get-installation-deployment')
  const { prepareLambdaContext, invokeLambdaExecutor } = await import('./lambda')

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
    return disabled("Couldn't load options — the app isn't deployed")
  }
  const { serverBundleSha, installation: inst } = installationResult.value
  if (!serverBundleSha) return disabled("Couldn't load options — the app isn't deployed")

  const baseContext = prepareLambdaContext({
    appId: input.appId,
    installationId: inst.id,
    organizationId: input.organizationId,
    organizationHandle: input.organizationHandle,
    userId: input.userId,
    userEmail: input.userEmail ?? null,
    userName: input.userName ?? null,
    userConnection: input.userConnection,
    organizationConnection: input.organizationConnection,
  })

  const lambdaResult = await invokeLambdaExecutor({
    caller: 'app-tool-options',
    payload: {
      type: 'tool',
      serverBundleSha,
      toolId: hint.optionsFrom,
      inputs: { ...hint.args, ...input.boundArgs },
      context: baseContext,
      invocationContext: input.invocationContext,
      timeout: 30000,
    },
  })
  if (lambdaResult.isErr()) {
    // A missing/expired connection is the one actionable case for the user.
    return disabled(
      lambdaResult.error.code === 'CONNECTION_REQUIRED'
        ? 'Reconnect the connection to load options'
        : "Couldn't load options — the resolver failed"
    )
  }
  const result = lambdaResult.value
  if (result.metadata?.runtime_error || result.metadata?.validation_error) {
    return disabled("Couldn't load options — the resolver errored")
  }
  const data = result.execution_result?.data ?? result.execution_result ?? {}
  return mapToolOutputToOptions(data, hint, input.query)
}

/**
 * Pure mapping from a resolver tool's raw output to the option list. Selects
 * items at `itemsPath` (or the first array found), projects each via
 * `valuePath`/`labelTemplate`/`sublabelTemplate`, drops valueless rows, and
 * locally filters by `query`.
 */
export function mapToolOutputToOptions(
  data: unknown,
  hint: DynamicSelectHint,
  query?: string
): ResolveToolOptionsResult {
  const items = selectItems(data, hint.itemsPath)
  const options: ToolOption[] = []
  for (const item of items) {
    const value = getPath(item, hint.valuePath)
    if (value === undefined || value === null || value === '') continue
    options.push({
      value: String(value),
      label: renderTemplate(hint.labelTemplate, item) || String(value),
      sublabel: hint.sublabelTemplate ? renderTemplate(hint.sublabelTemplate, item) : undefined,
    })
  }

  const filtered = filterOptions(options, query)
  return { options: filtered, disabledHint: filtered.length ? null : (hint.emptyHint ?? null) }
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
function filterOptions(options: ToolOption[], query?: string): ToolOption[] {
  const q = query?.trim().toLowerCase()
  if (!q) return options
  return options.filter((o) =>
    `${o.value} ${o.label} ${o.sublabel ?? ''}`.toLowerCase().includes(q)
  )
}
