// packages/lib/src/banking/feed/reaper.ts

/**
 * The billing reaper (open question **S4**).
 *
 * 🛑 **Stripe bills 30c per institution per account holder PER MONTH for transactions,
 * and nothing stops that charge except calling `disconnect` on the account.** A
 * customer who churned, a bank somebody disconnected in our UI, or a connector that was
 * deleted keeps costing money every month, invisibly, until a human reads an invoice.
 * `plans/bank-connection/README.md` §3 calls this out as its own line item and
 * open-question S4 says to build the reaper "regardless of the answers" to whether an
 * inactive account still bills - because the failure is silent and the fix is one API
 * call.
 *
 * Three doors, and this file is the third:
 *   1. **Disconnect in our UI** - `banking.bankAccount.disconnect` calls
 *      {@link reapBankFeedAccount} directly. Immediate, because the user just said so.
 *   2. **Connector delete** - the same call from the delete path.
 *   3. **The nightly sweep** - this file. It catches everything the first two missed: a
 *      connector left `disconnected` by a Stripe event nobody acted on, and an
 *      organization that was deleted out from under its connectors.
 *
 * ⚠️ The sweep waits {@link REAP_AFTER_DAYS} days. A `disconnected` connector is very
 * often a connection a person is about to REPAIR - `reconnectConnectorsForInstallation`
 * exists for exactly that - and disconnecting the account at Stripe makes the repair
 * impossible: the user has to authenticate at their bank again. Fourteen days is long
 * enough that anybody who meant to reconnect has, and short enough that a churned
 * customer costs at most one more billing cycle.
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { STRIPE_FC_CONNECTOR_TYPE } from '../../data-connectors/connectors/stripe-financial-connections'
import { disconnectAccountAtStripe, FC_PROVIDER_KEY } from './fc-client'

const logger = createScopedLogger('banking-feed-reaper')

/** How long a feed stays disconnected before its account is released at Stripe. */
export const REAP_AFTER_DAYS = 14

/**
 * The `DataConnector.state` key holding when this feed went dead.
 *
 * 🛑 **The clock may NOT key on `updatedAt`.** That column carries `$onUpdate`,
 * so every write to the row resets it - and `applyFinancialConnectionsEvent`
 * stamps `lastWebhookEventAt` unconditionally on every delivery, including the
 * disconnect and deactivate events themselves and every redelivery Stripe makes
 * afterwards. A dead connection would keep pushing its own cutoff forward and
 * bill 30c a month indefinitely, which is the exact failure this file exists to
 * stop.
 *
 * It lives in the connector's existing `state` jsonb rather than in a new
 * column: `state` is the connector-level runtime store, every other writer
 * touches it key-by-key with `jsonb_set` (`data-connectors/service.ts`), and a
 * schema change is not this slot's to make. `updatedAt` stays as the fallback
 * for a connector that went `disconnected` before this key existed.
 */
export const FEED_DISCONNECTED_AT_KEY = 'bankFeedDisconnectedAt'

/**
 * Start the 14-day clock on a feed that just went dead.
 *
 * ⚠️ **Write-once until it is cleared.** Stripe redelivers, and a bank that
 * emits `disconnected` twice a week would otherwise push the cutoff forward
 * forever. An existing value wins; {@link clearFeedDisconnectedAt} is the only
 * thing that removes it.
 */
export async function stampFeedDisconnectedAt(
  db: Database,
  connectorId: string,
  at: Date = new Date()
): Promise<void> {
  await db
    .update(schema.DataConnector)
    .set({
      state: sql`coalesce(${schema.DataConnector.state}, '{}'::jsonb) || jsonb_build_object(
        ${FEED_DISCONNECTED_AT_KEY}::text,
        coalesce(
          ${schema.DataConnector.state}->>${FEED_DISCONNECTED_AT_KEY}::text,
          ${at.toISOString()}
        )
      )`,
    })
    .where(eq(schema.DataConnector.id, connectorId))
}

/** Stop the clock: the feed is alive again, so the next death starts a fresh 14 days. */
export async function clearFeedDisconnectedAt(db: Database, connectorId: string): Promise<void> {
  await db
    .update(schema.DataConnector)
    .set({
      state: sql`coalesce(${schema.DataConnector.state}, '{}'::jsonb) - ${FEED_DISCONNECTED_AT_KEY}::text`,
    })
    .where(eq(schema.DataConnector.id, connectorId))
}

/** One connector the sweep decided to release. */
export interface ReapCandidate {
  connectorId: string
  organizationId: string
  credentialId: string
  providerAccountId: string
  /** Why it was picked: the connector is stale, or its organization is gone. */
  reason: 'disconnected' | 'organization-gone'
}

export interface ReapStats {
  candidates: number
  disconnected: number
  failed: number
}

/**
 * Every Financial Connections account that should no longer be billed.
 *
 * Exported and pure-ish (one SELECT, no writes) so the SELECTION can be tested without
 * calling Stripe - which is the half that has to be right. A reaper that releases one
 * account too many costs a customer a trip to their bank; one that releases too few
 * costs 30c a month forever.
 */
export async function findReapableBankFeeds(
  db: Database,
  now: Date = new Date()
): Promise<ReapCandidate[]> {
  const cutoff = new Date(now.getTime() - REAP_AFTER_DAYS * 86_400_000)

  const rows = await db
    .select({
      connectorId: schema.DataConnector.id,
      organizationId: schema.DataConnector.organizationId,
      credentialId: schema.Credential.id,
      providerAccountId: sql<string>`${schema.Credential.metadata}->>'providerAccountId'`,
      organizationRowId: schema.Organization.id,
      organizationDisabledAt: schema.Organization.disabledAt,
      connectorUpdatedAt: schema.DataConnector.updatedAt,
      status: schema.DataConnector.status,
    })
    .from(schema.DataConnector)
    .innerJoin(schema.Credential, eq(schema.DataConnector.credentialId, schema.Credential.id))
    .leftJoin(schema.Organization, eq(schema.Organization.id, schema.DataConnector.organizationId))
    .where(
      and(
        eq(schema.DataConnector.type, STRIPE_FC_CONNECTOR_TYPE),
        eq(schema.Credential.type, FC_PROVIDER_KEY),
        isNotNull(sql`${schema.Credential.metadata}->>'providerAccountId'`),
        // Three arms, and only ONE of them skips the waiting period.
        //
        // 🛑 `disabledAt` is ADMIN SUSPENSION, not deletion - a billing dispute,
        // an abuse review, an offboarding somebody may reverse tomorrow. Firing
        // on it with no grace would disconnect every Financial Connections
        // account the org has at Stripe that night, and every one of their banks
        // would then need a fresh authentication at the bank itself. So it waits
        // the same fourteen days the `disconnected` arm does.
        //
        // Only a HARD-DELETED organization (the LEFT JOIN found no row at all)
        // reaps immediately: there is nobody left to reconnect, and the rows
        // cannot come back.
        //
        // ⚠️ The `disconnected` clock reads `state->>'bankFeedDisconnectedAt'`,
        // falling back to `updatedAt` only for rows that went disconnected before
        // that key existed. See {@link FEED_DISCONNECTED_AT_KEY} for why
        // `updatedAt` alone is not a clock.
        sql`(
          (${schema.DataConnector.status} = 'disconnected'
            AND coalesce(
              (${schema.DataConnector.state}->>${FEED_DISCONNECTED_AT_KEY}::text)::timestamp,
              ${schema.DataConnector.updatedAt}
            ) < ${cutoff.toISOString()})
          OR (${schema.Organization.disabledAt} IS NOT NULL
            AND ${schema.Organization.disabledAt} < ${cutoff.toISOString()})
          OR ${schema.Organization.id} IS NULL
        )`
      )
    )

  return rows
    .filter((row) => !!row.providerAccountId)
    .map((row) => ({
      connectorId: row.connectorId,
      organizationId: row.organizationId,
      credentialId: row.credentialId,
      providerAccountId: row.providerAccountId,
      // 🛑 Keyed on whether the ORGANIZATION is there, not on the connector's
      // status. A hard-deleted org whose connector happened to already be
      // `disconnected` was previously reported as a stale feed, which is the
      // one case where the label is most misleading: nobody is coming back to
      // reconnect it.
      reason:
        row.organizationRowId == null || row.organizationDisabledAt
          ? ('organization-gone' as const)
          : ('disconnected' as const),
    }))
}

/**
 * Release one account at Stripe and record that we did.
 *
 * 🛑 It does NOT delete the connector, the `bank_account` or a single
 * `bank_transaction`. Releasing the account stops the bill; the rows behind it are the
 * source documents of postings and are kept for good (plans/bank-connection/02 §5.1).
 * The user-visible effect is that Reconnect now needs a fresh authentication at the
 * bank, which is exactly what has happened.
 */
export async function reapBankFeedAccount(
  db: Database,
  candidate: Pick<ReapCandidate, 'connectorId' | 'providerAccountId'>
): Promise<boolean> {
  const released = await disconnectAccountAtStripe(candidate.providerAccountId)
  if (!released) return false
  await db
    .update(schema.DataConnector)
    .set({
      status: 'disconnected',
      error:
        'This bank account was released at Stripe so it stops being billed. Reconnect the bank ' +
        'to start the feed again - every transaction already synced is kept.',
    })
    .where(eq(schema.DataConnector.id, candidate.connectorId))
  // Write-once, so a row the sweep already reaped keeps the date it actually died.
  await stampFeedDisconnectedAt(db, candidate.connectorId)
  return true
}

/** The nightly sweep. Never throws: one dead account must not stop the next. */
export async function reapDisconnectedBankFeeds(
  db: Database,
  now: Date = new Date()
): Promise<ReapStats> {
  const candidates = await findReapableBankFeeds(db, now)
  const stats: ReapStats = { candidates: candidates.length, disconnected: 0, failed: 0 }

  for (const candidate of candidates) {
    try {
      const released = await reapBankFeedAccount(db, candidate)
      if (released) stats.disconnected += 1
      else stats.failed += 1
    } catch (error) {
      stats.failed += 1
      logger.warn('Could not reap a bank feed', {
        connectorId: candidate.connectorId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (stats.candidates > 0) logger.info('Bank feed reaper finished', stats)
  return stats
}
