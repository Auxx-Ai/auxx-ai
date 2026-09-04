// packages/lib/src/banking/feed/webhook.ts

/**
 * Routing a platform Stripe event about a Financial Connections account to the
 * `DataConnector` that feeds from it.
 *
 * 🛑 **Nothing else in the codebase can do this.** Both existing webhook dispatch jobs
 * key on `credentialId + triggerId` or on `webhookEndpointId` - org-scoped ids a
 * PLATFORM Stripe event does not carry (plans/accounting/implementation-review.md §2).
 * The only handle an `fca_...` event has is the account id itself, so the lookup is
 * `Credential.metadata.providerAccountId` → `DataConnector.credentialId`, and it is
 * cross-org by necessity: the webhook arrives on auxx's own endpoint, not an org's.
 *
 * 🛑 **An `inactive` account is never read as "nothing to sync"**
 * (plans/bank-connection/01 §4.2 (5), open question **S4c**). Both subscribe and
 * refresh refuse on it, so a feed that stopped looks identical to a quiet account from
 * the ledger's side - the most expensive failure this subsystem has. Deactivation flips
 * the connector to `disconnected` and the account's status with it, so the settings row
 * says so and offers a Reconnect.
 *
 * ⚠️ Every handler here must be safe to run twice: Stripe redelivers, and the payments
 * route returns 500 on a throw so that it does.
 */

import { type Database, database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { STRIPE_FC_CONNECTOR_TYPE } from '../../data-connectors/connectors/stripe-financial-connections'
import { enqueueConnectorSync } from '../../data-connectors/data-connector-queue'
import { isSuspendedConnectorStatus } from '../../data-connectors/data-connector-scheduler'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { toRecordId } from '../../resources/resource-id'
import { loadBankAccountFieldContext } from '../reads'
import { refreshBankAccountCoverage } from './coverage'
import { FC_PROVIDER_KEY } from './fc-client'
import { clearFeedDisconnectedAt, stampFeedDisconnectedAt } from './reaper'

const logger = createScopedLogger('banking-feed')

/**
 * The four Financial Connections events this subsystem acts on.
 *
 * Exported so the one `case` in `applyStripeEvent` is a membership test rather than a
 * second copy of the list - the failure mode where a provider case list drifts from the
 * handler that implements it is the one B13 exists to prevent.
 */
export const FINANCIAL_CONNECTIONS_EVENT_TYPES = [
  'financial_connections.account.refreshed_transactions',
  'financial_connections.account.disconnected',
  'financial_connections.account.deactivated',
  'financial_connections.account.reactivated',
] as const

export type FinancialConnectionsEventType = (typeof FINANCIAL_CONNECTIONS_EVENT_TYPES)[number]

/** True when this event type belongs to the bank feed. */
export function isFinancialConnectionsEvent(type: string): type is FinancialConnectionsEventType {
  return (FINANCIAL_CONNECTIONS_EVENT_TYPES as readonly string[]).includes(type)
}

/** The bits of a Stripe event this router reads. Structural, so tests need no SDK. */
export interface FinancialConnectionsEvent {
  type: string
  data: { object: { id?: unknown; status?: unknown } }
}

/** The connector behind one `fca_...` account, or null when nothing feeds from it. */
export interface ResolvedFeedConnector {
  organizationId: string
  connectorId: string
  status: string
  credentialId: string
}

/**
 * Find the connector for a Financial Connections account id.
 *
 * ⚠️ Matched on the credential's `metadata->>'providerAccountId'` and NOT on any
 * denormalized copy. There is deliberately no `fca_` column anywhere: the credential is
 * where the durable provider handle lives (decision **B4**), and a second copy would be
 * a second answer to "which connection is this".
 */
export async function resolveFeedConnectorByAccountId(
  db: Database,
  providerAccountId: string
): Promise<ResolvedFeedConnector | null> {
  const [row] = await db
    .select({
      organizationId: schema.DataConnector.organizationId,
      connectorId: schema.DataConnector.id,
      status: schema.DataConnector.status,
      credentialId: schema.Credential.id,
    })
    .from(schema.Credential)
    .innerJoin(schema.DataConnector, eq(schema.DataConnector.credentialId, schema.Credential.id))
    .where(
      and(
        eq(schema.Credential.kind, 'connection'),
        eq(schema.Credential.type, FC_PROVIDER_KEY),
        eq(schema.DataConnector.type, STRIPE_FC_CONNECTOR_TYPE),
        sql`${schema.Credential.metadata}->>'providerAccountId' = ${providerAccountId}`
      )
    )
    .limit(1)

  return row ?? null
}

/**
 * Act on one Financial Connections event. Called by the single `case` in
 * `applyStripeEvent`, which is the only place the payments webhook knows this exists.
 *
 * Throws on a real failure so the route 500s and Stripe retries. An event for an
 * account nothing feeds from is NOT a failure - an org can disconnect a bank in our UI
 * and Stripe will keep telling us about it for a while.
 */
export async function applyFinancialConnectionsEvent(
  event: FinancialConnectionsEvent,
  db: Database = database
): Promise<void> {
  const accountId = event.data.object?.id
  if (typeof accountId !== 'string' || !accountId) return

  const feed = await resolveFeedConnectorByAccountId(db, accountId)
  if (!feed) {
    logger.debug('Financial Connections event for an account we do not feed from', {
      accountId,
      type: event.type,
    })
    return
  }

  await db
    .update(schema.DataConnector)
    .set({ lastWebhookEventAt: new Date() })
    .where(eq(schema.DataConnector.id, feed.connectorId))

  switch (event.type) {
    case 'financial_connections.account.refreshed_transactions': {
      // 🛑 Gate on STATUS, never on config completeness. A `disconnected` connector is
      // structurally indistinguishable from a healthy one - it keeps its credential and
      // its fully-configured streams - so every automated door has to ask the status
      // (#2049/#2050/#2051, and the data-connectors guide §18).
      if (isSuspendedConnectorStatus(feed.status)) {
        logger.info('Refresh event ignored - the connector is suspended', {
          connectorId: feed.connectorId,
          status: feed.status,
        })
        return
      }
      await enqueueConnectorSync({
        connectorId: feed.connectorId,
        organizationId: feed.organizationId,
        trigger: 'webhook',
      })
      // Coverage from the rows the PREVIOUS refresh landed. One cycle behind by
      // construction (the sync we just queued has not run), and the nightly sweep is
      // what makes it eventually right; `readCoverage` derives it live for the UI in
      // the meantime, so nothing a person sees is stale.
      await refreshBankAccountCoverage(db, {
        organizationId: feed.organizationId,
        connectorId: feed.connectorId,
      })
      return
    }

    case 'financial_connections.account.disconnected':
    case 'financial_connections.account.deactivated': {
      await markFeedDisconnected(db, feed, event.type)
      return
    }

    case 'financial_connections.account.reactivated': {
      await markFeedReconnected(db, feed)
      return
    }

    default:
      return
  }
}

/**
 * The feed is dead: flip the connector and the `bank_account` status, and say why.
 *
 * 🛑 The word "Reconnect" in the message is load-bearing, not prose.
 * `classifyConnectorError` matches on it and routes the connector to `action-needed`
 * with the non-dismissible banner and a Reconnect button - rather than a generic error
 * with a Retry button that cannot possibly work, because retrying a refresh on an
 * inactive account is refused by Stripe every time.
 */
async function markFeedDisconnected(
  db: Database,
  feed: ResolvedFeedConnector,
  eventType: string
): Promise<void> {
  await db
    .update(schema.DataConnector)
    .set({
      status: 'disconnected',
      error:
        'The bank ended this connection. Reconnect the account to start the feed again. Every ' +
        'transaction already synced is kept.',
    })
    .where(eq(schema.DataConnector.id, feed.connectorId))

  // 🛑 The reaper's 14-day clock starts HERE, on a key of its own, because the
  // `lastWebhookEventAt` write above resets `updatedAt` on every redelivery -
  // see `FEED_DISCONNECTED_AT_KEY`. Write-once, so a bank that emits the event
  // repeatedly cannot keep pushing the cutoff forward.
  await stampFeedDisconnectedAt(db, feed.connectorId)

  await setBankAccountStatus(db, feed, 'disconnected')
  logger.info('Bank feed marked disconnected from a Stripe event', {
    connectorId: feed.connectorId,
    eventType,
  })
}

/** The bank let us back in without a re-authentication. Re-arm and pull. */
async function markFeedReconnected(db: Database, feed: ResolvedFeedConnector): Promise<void> {
  await db
    .update(schema.DataConnector)
    .set({ status: 'pending', error: null })
    .where(eq(schema.DataConnector.id, feed.connectorId))
  // The clock stops, so a later death starts a fresh fourteen days.
  await clearFeedDisconnectedAt(db, feed.connectorId)
  await setBankAccountStatus(db, feed, 'connected')
  await enqueueConnectorSync({
    connectorId: feed.connectorId,
    organizationId: feed.organizationId,
    trigger: 'webhook',
  })
}

/** Write the `bank_account.status` for the account this connector feeds. */
async function setBankAccountStatus(
  db: Database,
  feed: ResolvedFeedConnector,
  status: 'connected' | 'disconnected'
): Promise<void> {
  const ctx = await loadBankAccountFieldContext(feed.organizationId)
  const field = ctx?.fields.bank_account_connector_id
  if (!ctx || !field) return

  const row = await db.query.FieldValue.findFirst({
    where: (fv, { and: a, eq: e }) =>
      a(
        e(fv.organizationId, feed.organizationId),
        e(fv.fieldId, field.id),
        e(fv.valueText, feed.connectorId)
      ),
    columns: { entityId: true },
  })
  if (!row) return

  const systemUserId = await getOrgCache().get(feed.organizationId, 'systemUser')
  const crud = new UnifiedCrudHandler(feed.organizationId, systemUserId, db)
  await crud.update(toRecordId(ctx.bankAccountDefId, row.entityId), {
    bank_account_status: status,
  })
}
