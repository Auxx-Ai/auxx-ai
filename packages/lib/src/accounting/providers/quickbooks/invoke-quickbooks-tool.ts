// packages/lib/src/accounting/providers/quickbooks/invoke-quickbooks-tool.ts
//
// The QuickBooks-pinned door onto `apps/invoke-app-tool.ts`: resolves the `quickbooks` app
// installation + deployment + connection for an org ONCE and exposes the same `callTool`
// closure, so the accounting provider and the customer upsert reuse one handle across every
// `find_/create_/update_quickbooks_*` tool call. The chain itself (installation ->
// deployment -> connection -> Lambda) lives in the slug-parameterised resolver, shared with
// the Shopify Payments payout source (brief 27 §5).

import type { CatalogTool } from '@auxx/database'
import { type AppToolContext, resolveAppToolContext } from '../../../apps/invoke-app-tool'
import { readQuickbooksAccountMap } from './account-map'

const QUICKBOOKS_APP_SLUG = 'quickbooks'
const QUICKBOOKS_APP_LABEL = 'QuickBooks'

/**
 * Reusable QuickBooks Lambda-runtime handle, resolved once per sync run, then used to call
 * as many app tools as needed without re-resolving the installation/deployment/connection
 * chain per call.
 */
export interface QuickbooksToolContext {
  organizationId: string
  installationId: string
  /** The resolved Credential id (org- or user-scoped). Connection-scoped `CustomField` rows key off this. */
  connectionId: string
  /** `actorUserId` if given, else the org's system user; used for entity reads/writes too. */
  userId: string
  /** `connection.metadata.realmId`, when present. Informational, not required by callers. */
  realmId?: string
  tools?: CatalogTool[]
  serverBundleSha?: string
  /** Invoke one QuickBooks app tool by id, returning its unwrapped `execution_result.data`. */
  callTool: AppToolContext['callTool']
  /** The confirmed `gl_account -> QuickBooks account` map, read once per context and memoised. */
  accountMap: () => Promise<Map<string, string>>
}

export type ResolveQuickbooksContextResult =
  | { connected: true; context: QuickbooksToolContext }
  | { connected: false }

/**
 * Resolve the QuickBooks app installation + deployment + connection for an org.
 *
 * `connected: false` covers every reason a sync can't proceed (the app isn't installed, has
 * no active deployment, or has neither an org- nor user-scoped connection) so the caller
 * (`quickbooks-accounting-provider.ts`, which pushes journal entries only; the invoice
 * document mirror was retired 2026-09-10 per brief 14's DECIDED block) can collapse all of
 * them into `status: 'not_connected'` without branching on why.
 */
export async function resolveQuickbooksContext(input: {
  organizationId: string
  actorUserId?: string
  pinnedCredentialId?: string
  expectedCompanyId?: string
}): Promise<ResolveQuickbooksContextResult> {
  const resolved = await resolveAppToolContext({
    organizationId: input.organizationId,
    appSlug: QUICKBOOKS_APP_SLUG,
    appLabel: QUICKBOOKS_APP_LABEL,
    actorUserId: input.actorUserId,
    pinnedCredentialId: input.pinnedCredentialId,
    expectedCompanyId: input.expectedCompanyId,
    // The customer/item tools call back into entities (e.g. resolving an existing
    // auxxContactId) via the SDK's entity value-I/O, which requires the `entities` scope.
    includeEntitiesScope: true,
  })
  if (!resolved.connected) return { connected: false }

  const { context } = resolved
  const realmId = context.connectionMetadata?.realmId
  let accountMap: Promise<Map<string, string>> | undefined
  return {
    connected: true,
    context: {
      organizationId: context.organizationId,
      installationId: context.installationId,
      connectionId: context.connectionId,
      userId: context.userId,
      ...(typeof realmId === 'string' ? { realmId } : {}),
      callTool: context.callTool,
      tools: context.tools,
      serverBundleSha: context.serverBundleSha,
      accountMap: () => {
        accountMap ??= readQuickbooksAccountMap({
          organizationId: context.organizationId,
          installationId: context.installationId,
          connectionId: context.connectionId,
        }).catch((error: unknown) => {
          // A failed read is not memoised, so the next caller retries it.
          accountMap = undefined
          throw error
        })
        return accountMap
      },
    },
  }
}
