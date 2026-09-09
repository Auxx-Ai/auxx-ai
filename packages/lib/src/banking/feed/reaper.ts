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
 * Four doors end a bank feed, numbered as `plans/bank-connection/08-removing-a-bank-account.md`
 * §5.4 numbers them, and every one of them now releases:
 *   1. **Disconnect in our UI** - `banking.bankAccount.disconnect` calls
 *      {@link reapBankFeedAccount} directly. Immediate, because the user just said so.
 *   2. **The nightly sweep** - this file. It catches what the others could not: a
 *      connector left `disconnected` by a Stripe event nobody acted on, and an
 *      organization that was suspended rather than deleted.
 *   3. **Connector delete** - `data-connectors/mutations.ts`'s `deleteConnector` resolves
 *      the account with {@link findBankFeedAccountForConnector} and calls
 *      {@link reapBankFeedAccount} BEFORE it marks the row `deleting`, because the
 *      teardown takes the `providerAccountId` with it.
 *   4. **Organization delete** - `organizations/organization-service.ts` lists the org's
 *      accounts with {@link listBankFeedAccountsForOrganization} and releases each one
 *      BEFORE its transaction.
 *
 * 🛑 Doors 3 and 4 are NOT backstopped by the sweep, which is why they call the release
 * themselves rather than leaving it to this file. `DataConnector.organizationId` is
 * `onDelete: 'cascade'` and the connector teardown removes the row outright, so both of
 * them destroy the evidence the sweep selects on - in door 4's case in the very
 * transaction that would otherwise create the leak.
 *
 * ⚠️ Both of them tolerate a failed release and carry on. That is deliberate, and it is
 * the opposite tradeoff from the plan-subscription cancel that sits beside door 4: a
 * leaked 30c is recoverable by a human reading an invoice, an organization or a
 * connector that can never be removed is not.
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
import { PROVIDER_ACCOUNT_ID_METADATA_KEY } from '../../connections/hosted-provision/types'
import { STRIPE_FC_CONNECTOR_TYPE } from '../../data-connectors/connectors/stripe-financial-connections-type'
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

/**
 * One Financial Connections account that can still be released at Stripe.
 *
 * The unit every door works in: a connector row, the credential it is bound to, and the
 * `fca_...` id on that credential's metadata. Without the last of those there is nothing
 * to call disconnect on.
 */
export interface BankFeedAccountRef {
  connectorId: string
  organizationId: string
  credentialId: string
  providerAccountId: string
}

/** One connector the sweep decided to release. */
export interface ReapCandidate extends BankFeedAccountRef {
  /** Why it was picked: the connector is stale, or its organization is gone. */
  reason: 'disconnected' | 'organization-gone'
}

/**
 * The columns every door reads, resolved the same way in all of them.
 *
 * 🛑 `providerAccountId` lives in the CREDENTIAL's jsonb metadata, not on the connector,
 * under the shared {@link PROVIDER_ACCOUNT_ID_METADATA_KEY} rather than a retyped
 * string literal - `Credential.metadata` is `Record<string, unknown>`, so a drifted
 * key would filter out every candidate here and report a healthy sweep releasing
 * nothing while every account kept billing.
 * so every path that wants to release an account has to make this join. Sharing the
 * projection is what stops door 3 or door 4 inventing its own and quietly reading the
 * wrong key.
 */
const feedAccountColumns = {
  connectorId: schema.DataConnector.id,
  organizationId: schema.DataConnector.organizationId,
  credentialId: schema.Credential.id,
  providerAccountId: sql<string>`${schema.Credential.metadata}->>${PROVIDER_ACCOUNT_ID_METADATA_KEY}`,
}

/**
 * A Financial Connections connector whose credential still carries an account to release.
 *
 * Shared by all three SQL doors - the sweep ({@link findReapableBankFeeds}), door 4
 * ({@link listBankFeedAccountsForOrganization}) and door 3
 * ({@link findBankFeedAccountForConnector}).
 *
 * ⚠️ **`Credential.type` is transitional.** Its schema comment
 * (`packages/database/src/db/schema/credential.ts`) marks it a denormalized providerKey
 * that the resolved `ConnectionDefinition.providerKey` supersedes in Phase 2. Whoever
 * does that migration has to come through here: these three queries key on it, and
 * because the predicate only ever NARROWS the candidate set, a stale match does not
 * fail loudly - the sweep reports zero candidates, looks healthy, and every account
 * keeps billing at 30c a month. Same silent failure the shared
 * {@link PROVIDER_ACCOUNT_ID_METADATA_KEY} exists to prevent, one column over.
 */
function releasableBankFeedFilter() {
  return and(
    eq(schema.DataConnector.type, STRIPE_FC_CONNECTOR_TYPE),
    eq(schema.Credential.type, FC_PROVIDER_KEY),
    isNotNull(sql`${schema.Credential.metadata}->>${PROVIDER_ACCOUNT_ID_METADATA_KEY}`)
  )
}

/**
 * Every releasable account one organization holds. Door 4 (organization delete).
 *
 * 🛑 No status filter. A `disconnected` connector is a connection Stripe or the bank
 * dropped, NOT an account that was released - it is still billing. The org is going
 * away, so every account it holds has to go with it.
 */
export async function listBankFeedAccountsForOrganization(
  db: Database,
  organizationId: string
): Promise<BankFeedAccountRef[]> {
  const rows = await db
    .select(feedAccountColumns)
    .from(schema.DataConnector)
    .innerJoin(schema.Credential, eq(schema.DataConnector.credentialId, schema.Credential.id))
    .where(and(releasableBankFeedFilter(), eq(schema.DataConnector.organizationId, organizationId)))

  return rows.filter((row) => !!row.providerAccountId)
}

/**
 * The releasable account behind ONE connector, org-scoped. Door 3 (connector delete).
 *
 * Returns null for every non-Financial-Connections connector and for an FC connector
 * whose credential has no account id left, which is the caller's cue to do nothing.
 */
export async function findBankFeedAccountForConnector(
  db: Database,
  organizationId: string,
  connectorId: string
): Promise<BankFeedAccountRef | null> {
  const rows = await db
    .select(feedAccountColumns)
    .from(schema.DataConnector)
    .innerJoin(schema.Credential, eq(schema.DataConnector.credentialId, schema.Credential.id))
    .where(
      and(
        releasableBankFeedFilter(),
        eq(schema.DataConnector.organizationId, organizationId),
        eq(schema.DataConnector.id, connectorId)
      )
    )
    .limit(1)

  const row = rows[0]
  return row?.providerAccountId ? row : null
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
      ...feedAccountColumns,
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
        releasableBankFeedFilter(),
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
