// packages/lib/src/apps/invoke-app-tool.ts
//
// Resolves an installed app's installation + deployment + connection for an org ONCE, then
// exposes a `callTool` closure that drives `invokeLambdaExecutor`: the same
// installation -> deployment -> connection -> Lambda chain `quick-action-executor.ts` uses
// for quick actions (`packages/lib/src/quick-actions/quick-action-executor.ts`). Callers
// (the QuickBooks accounting provider, the Shopify Payments payout source, and any future
// platform-initiated sync that reaches an app's tools) resolve this once per run and reuse
// it across every tool call.
//
// Generalised from `money/quickbooks/invoke-quickbooks-tool.ts` (brief 27 §5), which is now
// a thin wrapper pinning the `quickbooks` slug.

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getCachedInstalledApps, getOrgCache } from '../cache'

const logger = createScopedLogger('apps:invoke-app-tool')

/**
 * Caller identity threaded through `invokeLambdaExecutor`'s HMAC signature + allowlist.
 * A general "platform-initiated app-tool orchestration" origin, shared by invoice sync,
 * payment push, payout reads and any future outbound integration sync, not a per-feature
 * caller. See `CALLER_TYPE_ALLOWLIST` in `apps/lambda/src/index.ts`.
 */
export const APP_TOOL_CALLER = 'integration-sync'
/** Matches the quick-action-executor's per-call Lambda timeout. */
export const APP_TOOL_TIMEOUT_MS = 30_000

/**
 * Reusable Lambda-runtime handle onto one installed app, resolved once per run, then used
 * to call as many of its tools as needed without re-resolving the
 * installation/deployment/connection chain per call.
 */
export interface AppToolContext {
  organizationId: string
  appSlug: string
  installationId: string
  /** The resolved Credential id (org- or user-scoped). Connection-scoped `CustomField` rows key off this. */
  connectionId: string
  /** `actorUserId` if given, else the org's system user; used for entity reads/writes too. */
  userId: string
  /** The connection's stored `metadata`, when any. Provider-specific (QuickBooks keeps `realmId` here). */
  connectionMetadata: Record<string, unknown> | undefined
  /** Invoke one app tool by id, returning its unwrapped `execution_result.data`. */
  callTool: (toolId: string, inputs: Record<string, unknown>) => Promise<any>
}

export type ResolveAppToolContextResult =
  | { connected: true; context: AppToolContext }
  | { connected: false }

export interface ResolveAppToolContextInput {
  organizationId: string
  /** The `App.slug` to reach, e.g. `quickbooks` or `shopify`. */
  appSlug: string
  /** How the app is named in thrown errors and logs. Defaults to the slug. */
  appLabel?: string
  actorUserId?: string
  /**
   * Grant the Lambda context the `entities` scope, for tools that call back into
   * entity value-I/O through the SDK (the QuickBooks customer/item tools resolve
   * an existing `auxxContactId` that way). Off unless the caller's tools need it.
   */
  includeEntitiesScope?: boolean
}

/**
 * Resolve an installed app's installation + deployment + connection for an org.
 *
 * `connected: false` covers every reason a sync cannot proceed: the app is not installed,
 * has no active deployment, or has neither an org- nor a user-scoped connection. The
 * caller collapses all of them into "not connected" without branching on why.
 */
export async function resolveAppToolContext(
  input: ResolveAppToolContextInput
): Promise<ResolveAppToolContextResult> {
  const { organizationId, appSlug, actorUserId, includeEntitiesScope = false } = input
  const appLabel = input.appLabel ?? appSlug

  const installedApps = await getCachedInstalledApps(organizationId)
  const install = installedApps.find((a) => a.app.slug === appSlug)
  if (!install) return { connected: false }

  const userId = actorUserId ?? (await getOrgCache().get(organizationId, 'systemUser'))

  const org = await database.query.Organization.findFirst({
    where: (t, { eq }) => eq(t.id, organizationId),
    columns: { handle: true },
  })
  if (!org?.handle) {
    logger.warn(`No organization handle, cannot resolve ${appLabel} deployment`, {
      organizationId,
      appSlug,
    })
    return { connected: false }
  }

  // Lazy imports keep the app-runtime cluster out of this module's static graph
  // (mirrors quick-action-executor.ts).
  const { getInstallationDeployment } = await import('./installations/get-installation-deployment')
  const { resolveAppConnectionForRuntime } = await import(
    './connections/resolve-app-connection-for-runtime'
  )
  const { prepareLambdaContext, invokeLambdaExecutor } = await import('./lambda')

  const deploymentResult = await getInstallationDeployment({
    installationId: install.installationId,
    organizationHandle: org.handle,
    appId: install.app.id,
  })
  if (deploymentResult.isErr()) {
    logger.warn(`Failed to resolve ${appLabel} installation deployment`, {
      organizationId,
      appSlug,
      error: deploymentResult.error.message,
    })
    return { connected: false }
  }
  const { serverBundleSha, installation } = deploymentResult.value
  if (!serverBundleSha) return { connected: false }

  const connectionsResult = await resolveAppConnectionForRuntime({
    appId: install.app.id,
    organizationId,
    userId,
  })
  if (connectionsResult.isErr()) {
    logger.warn(`Failed to resolve ${appLabel} connection`, {
      organizationId,
      appSlug,
      error: connectionsResult.error.message,
    })
    return { connected: false }
  }
  const { organizationConnection, userConnection } = connectionsResult.value
  const connection = organizationConnection ?? userConnection
  if (!connection) return { connected: false }

  const baseContext = prepareLambdaContext({
    appId: install.app.id,
    installationId: installation.id,
    organizationId,
    organizationHandle: org.handle,
    userId,
    userEmail: null,
    userName: null,
    userConnection,
    organizationConnection,
    includeEntitiesScope,
  })

  const callTool = async (toolId: string, inputs: Record<string, unknown>): Promise<any> => {
    const result = await invokeLambdaExecutor({
      caller: APP_TOOL_CALLER,
      payload: {
        type: 'tool',
        serverBundleSha,
        toolId,
        inputs,
        context: baseContext,
        timeout: APP_TOOL_TIMEOUT_MS,
      },
    })

    if (result.isErr()) {
      // Carry `code`, `statusCode` and `details` onto the thrown error rather than
      // flattening the failure to a message.
      //
      // `quickbooks-accounting-provider.ts` classifies a failed post as
      // configuration / data / transport, and that split decides whether a journal
      // entry is retried: retrying a `2300` imbalance can never succeed, and NOT
      // retrying a 429 turns a rate limit into a permanent posting failure. The
      // Shopify payout source reads `INSUFFICIENT_PERMISSIONS` + `details.requiredScopes`
      // the same way to name the scope a store has not granted. With only a message
      // string to read, every failure looks the same.
      //
      // A provider's own fault object is attached by the apps repo as a NON-ENUMERABLE
      // property and does not survive the Lambda boundary's JSON round-trip;
      // `code`/`statusCode`/`details` do, on `LambdaExecutionError`.
      const error = new Error(`${appLabel} tool ${toolId} failed: ${result.error.message}`)
      Object.assign(error, {
        code: result.error.code,
        statusCode: result.error.statusCode,
        details: result.error.details,
      })
      throw error
    }

    const { execution_result: executionResult, metadata } = result.value
    if (metadata?.runtime_error) {
      throw new Error(`${appLabel} tool ${toolId} runtime error: ${metadata.runtime_error.message}`)
    }
    if (metadata?.validation_error) {
      throw new Error(
        `${appLabel} tool ${toolId} validation error: ${metadata.validation_error.message}`
      )
    }

    return executionResult?.data ?? executionResult ?? {}
  }

  return {
    connected: true,
    context: {
      organizationId,
      appSlug,
      installationId: installation.id,
      connectionId: connection.id,
      userId,
      connectionMetadata: isRecord(connection.metadata) ? connection.metadata : undefined,
      callTool,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
