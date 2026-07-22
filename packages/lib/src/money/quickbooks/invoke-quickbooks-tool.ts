// packages/lib/src/money/quickbooks/invoke-quickbooks-tool.ts
//
// Resolves the QuickBooks app installation + deployment + connection for an org ONCE, then
// exposes a `callTool` closure that drives `invokeLambdaExecutor` — the same
// installation → deployment → connection → Lambda chain `quick-action-executor.ts` uses for
// quick actions (`packages/lib/src/quick-actions/quick-action-executor.ts`). Callers (the
// invoice-sync orchestrator, and later the payment-push orchestrator) resolve this once per
// run and reuse it across every `find_/create_/update_quickbooks_*` tool call.

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getCachedInstalledApps, getOrgCache } from '../../cache'

const logger = createScopedLogger('quickbooks-invoke-tool')

const QUICKBOOKS_APP_SLUG = 'quickbooks'
/**
 * Caller identity threaded through `invokeLambdaExecutor`'s HMAC signature + allowlist.
 * A general "platform-initiated app-tool orchestration" origin — shared by invoice sync,
 * the upcoming payment push, and any future outbound integration sync — not a per-feature
 * caller. See `CALLER_TYPE_ALLOWLIST` in `apps/lambda/src/index.ts`.
 */
const CALLER = 'integration-sync'
/** Matches the quick-action-executor's per-call Lambda timeout. */
const TOOL_TIMEOUT_MS = 30_000

/**
 * Reusable QuickBooks Lambda-runtime handle — resolved once per sync run, then used to call
 * as many app tools as needed without re-resolving the installation/deployment/connection
 * chain per call.
 */
export interface QuickbooksToolContext {
  organizationId: string
  installationId: string
  /** The resolved Credential id (org- or user-scoped) — connection-scoped `CustomField` rows key off this. */
  connectionId: string
  /** `actorUserId` if given, else the org's system user — used for entity reads/writes too. */
  userId: string
  /** `connection.metadata.realmId`, when present — informational, not required by callers. */
  realmId?: string
  /** Invoke one QuickBooks app tool by id, returning its unwrapped `execution_result.data`. */
  callTool: (toolId: string, inputs: Record<string, unknown>) => Promise<any>
}

export type ResolveQuickbooksContextResult =
  | { connected: true; context: QuickbooksToolContext }
  | { connected: false }

/**
 * Resolve the QuickBooks app installation + deployment + connection for an org.
 *
 * `connected: false` covers every reason a sync can't proceed — the app isn't installed, has
 * no active deployment, or has neither an org- nor user-scoped connection — so the caller
 * (`syncInvoiceToQuickbooks`) can collapse all of them into `status: 'not_connected'` without
 * branching on why.
 */
export async function resolveQuickbooksContext(input: {
  organizationId: string
  actorUserId?: string
}): Promise<ResolveQuickbooksContextResult> {
  const { organizationId, actorUserId } = input

  const installedApps = await getCachedInstalledApps(organizationId)
  const qbInstall = installedApps.find((a) => a.app.slug === QUICKBOOKS_APP_SLUG)
  if (!qbInstall) return { connected: false }

  const userId = actorUserId ?? (await getOrgCache().get(organizationId, 'systemUser'))

  const org = await database.query.Organization.findFirst({
    where: (t, { eq }) => eq(t.id, organizationId),
    columns: { handle: true },
  })
  if (!org?.handle) {
    logger.warn('No organization handle — cannot resolve QuickBooks deployment', {
      organizationId,
    })
    return { connected: false }
  }

  // Lazy imports keep the app-runtime cluster out of this module's static graph
  // (mirrors quick-action-executor.ts).
  const { getInstallationDeployment } = await import(
    '../../apps/installations/get-installation-deployment'
  )
  const { resolveAppConnectionForRuntime } = await import(
    '../../apps/connections/resolve-app-connection-for-runtime'
  )
  const { prepareLambdaContext, invokeLambdaExecutor } = await import('../../apps/lambda')

  const deploymentResult = await getInstallationDeployment({
    installationId: qbInstall.installationId,
    organizationHandle: org.handle,
    appId: qbInstall.app.id,
  })
  if (deploymentResult.isErr()) {
    logger.warn('Failed to resolve QuickBooks installation deployment', {
      organizationId,
      error: deploymentResult.error.message,
    })
    return { connected: false }
  }
  const { serverBundleSha, installation } = deploymentResult.value
  if (!serverBundleSha) return { connected: false }

  const connectionsResult = await resolveAppConnectionForRuntime({
    appId: qbInstall.app.id,
    organizationId,
    userId,
  })
  if (connectionsResult.isErr()) {
    logger.warn('Failed to resolve QuickBooks connection', {
      organizationId,
      error: connectionsResult.error.message,
    })
    return { connected: false }
  }
  const { organizationConnection, userConnection } = connectionsResult.value
  const connection = organizationConnection ?? userConnection
  if (!connection) return { connected: false }

  const baseContext = prepareLambdaContext({
    appId: qbInstall.app.id,
    installationId: installation.id,
    organizationId,
    organizationHandle: org.handle,
    userId,
    userEmail: null,
    userName: null,
    userConnection,
    organizationConnection,
    // The customer/item tools call back into entities (e.g. resolving an existing
    // auxxContactId) via the SDK's entity value-I/O — requires the `entities` scope.
    includeEntitiesScope: true,
  })

  const callTool = async (toolId: string, inputs: Record<string, unknown>): Promise<any> => {
    const result = await invokeLambdaExecutor({
      caller: CALLER,
      payload: {
        type: 'tool',
        serverBundleSha,
        toolId,
        inputs,
        context: baseContext,
        timeout: TOOL_TIMEOUT_MS,
      },
    })

    if (result.isErr()) {
      throw new Error(`QuickBooks tool ${toolId} failed: ${result.error.message}`)
    }

    const { execution_result: executionResult, metadata } = result.value
    if (metadata?.runtime_error) {
      throw new Error(`QuickBooks tool ${toolId} runtime error: ${metadata.runtime_error.message}`)
    }
    if (metadata?.validation_error) {
      throw new Error(
        `QuickBooks tool ${toolId} validation error: ${metadata.validation_error.message}`
      )
    }

    return executionResult?.data ?? executionResult ?? {}
  }

  return {
    connected: true,
    context: {
      organizationId,
      installationId: installation.id,
      connectionId: connection.id,
      userId,
      realmId: connection.metadata?.realmId,
      callTool,
    },
  }
}
