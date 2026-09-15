// packages/lib/src/postings/source-scope.ts

/**
 * The SOURCES a role map may be scoped to (task 47 §2, §3, §7.4).
 *
 * `GlRoleAssignment.sourceAccountId` points at a `FinancialSourceAccount`, and
 * this file is the only place that decides what that set contains and what each
 * row is called. Two jobs:
 *
 *  1. **Mint and find the MANUAL bucket.** An order with no connected source
 *     still has to resolve somewhere, and `sourceAccountId IS NULL` cannot be
 *     that somewhere: null already means "no override", and a column that meant
 *     both would need a `scopeKind` discriminator, a check constraint keeping
 *     the two in sync, a third partial unique index and a special case in every
 *     renderer. So manual is a ROW - `providerKey: 'auxx'`,
 *     `externalAccountId: 'manual'` - which the existing identity unique already
 *     protects and the existing check constraint already accepts.
 *     **`FinancialSourceAccount` needs no schema change at all** (47 §3).
 *
 *  2. **List the sources a settings screen may offer, per AXIS.** A revenue role
 *     lists the storefronts and Manual; the fee role lists the merchant accounts
 *     money settles through. Offering every source under every role would hand a
 *     bookkeeper a Stripe account to book product revenue to.
 *
 * ## 🛑 Why the sentinel is safe, and the one thing that would break it
 *
 * Every read of `FinancialSourceAccount` in `packages/lib` either filters
 * `providerKey = 'shopify'` or joins in from an evidence row
 * (`FinancialSourceObject`, `FinancialSourceAcceptance`, `MoneyTransfer`,
 * `ProcessorBalanceEntry`, `FinancialSourceObservation`); `apps/web` never
 * touches the table. **A row with no evidence pointing at it is invisible to all
 * of them**, which is what makes a fake account safe rather than clever.
 *
 * A future "list every source" read would surface a store that does not exist in
 * somebody's UI. Re-check 47 §3.1 before widening one.
 *
 * ## 🛑 The sentinel is a MAPPING KEY, never an effect value
 *
 * Do not backfill it into effects. `sourceStoreId` stays nullable on the
 * fulfillment effect and keeps meaning "this record had no connected source",
 * which is true and which `recognition-source.ts`'s live / non-archived guards
 * rely on. The translation from null to the manual row happens in exactly one
 * place, on the resolution side, in `resolve-roles.ts` (47 §3.2).
 *
 * No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { ScopeAxis } from './build-entry'
// 🛑 `RoleSourceRow` lives in `types.ts`, which is client-safe: a settings
// screen holds the shape and this file reaches a database. Re-exported so a
// server caller still gets it from the module that produces it.
import type { RoleSourceRow } from './types'

export type { RoleSourceRow } from './types'

/**
 * The manual bucket's provider namespace.
 *
 * ⚠️ The honest cost, stated once: the table is called
 * `FinancialSourceAccount` and a manual bucket is not an account at a financial
 * source. `'auxx'` reads as "the source is us", which mostly carries it. The row
 * earns its place by making every other layer uniform - one FK, one picker, one
 * renderer - and Synder made the same call: their provider enum carries
 * `CUSTOM`, `SYNDER` and `EXTERNAL_URL` beside `SHOPIFY` and `STRIPE`.
 */
export const MANUAL_SOURCE_PROVIDER_KEY = 'auxx'

/** The manual bucket's external id within {@link MANUAL_SOURCE_PROVIDER_KEY}. */
export const MANUAL_SOURCE_EXTERNAL_ID = 'manual'

/** What a person sees where a connected source would show its own name. */
export const MANUAL_SOURCE_LABEL = 'Manual'

/**
 * The org's manual bucket, minted if it is not there yet.
 *
 * 🛑 Called where the CHART is provisioned, never lazily on the first manual
 * order (47 §6.3): lazy creation races with itself, and the settings page needs
 * the row to exist before anybody posts. The migration mints it for every org
 * that already exists; this covers every org provisioned after it.
 *
 * Idempotent by the existing `FinancialSourceAccount_identity_key`, so pressing
 * "Add accounts" twice is a no-op rather than a second bucket.
 */
export async function ensureManualSourceAccount(
  db: Database | Transaction,
  organizationId: string
): Promise<string> {
  await db
    .insert(schema.FinancialSourceAccount)
    .values({
      organizationId,
      providerKey: MANUAL_SOURCE_PROVIDER_KEY,
      externalAccountId: MANUAL_SOURCE_EXTERNAL_ID,
      environment: 'live',
    })
    .onConflictDoNothing()

  const id = await readManualSourceAccountId(db, organizationId)
  if (!id) {
    // Unreachable: the insert above either wrote the row or collided with it.
    // Asserted because the alternative is a manual order silently resolving
    // through the org default while a "Manual" row sits mapped in settings.
    throw new Error(`Manual source account missing for organization ${organizationId}`)
  }
  return id
}

/**
 * The org's manual bucket id, or null when nothing has provisioned one.
 *
 * ⚠️ Null is an ORDINARY answer, not an error: an org whose chart has never been
 * provisioned has no bucket, and a store-axis role with no store then resolves
 * to the org default - which is exactly what it did before this brief. The
 * resolver must not refuse over it (47 §5, decision D6).
 */
export async function readManualSourceAccountId(
  db: Database | Transaction,
  organizationId: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.FinancialSourceAccount.id })
    .from(schema.FinancialSourceAccount)
    .where(
      and(
        eq(schema.FinancialSourceAccount.organizationId, organizationId),
        eq(schema.FinancialSourceAccount.providerKey, MANUAL_SOURCE_PROVIDER_KEY),
        eq(schema.FinancialSourceAccount.externalAccountId, MANUAL_SOURCE_EXTERNAL_ID),
        eq(schema.FinancialSourceAccount.environment, 'live'),
        isNull(schema.FinancialSourceAccount.archivedAt)
      )
    )
    .limit(1)
  return row?.id ?? null
}

/**
 * Every live source this org's role map may be scoped to, manual pinned first.
 *
 * 🛑 **Every live source gets a row, always**, including the ones that inherit
 * the org default. An unconfigured store must be VISIBLE rather than absent -
 * "Amazon US is using 4000 Product Revenue" is the fact the screen exists to
 * surface, and a screen that only listed overrides could never say it.
 *
 * Sorted manual first, then by name. Sorting by `providerKey` would bury `auxx`
 * between `amazon` and `shopify`, which is a sort order that hides the one row
 * every org has.
 *
 * Archived and non-`live` accounts are excluded IN THE QUERY, the same rule
 * `recognition-source.ts` applies to evidence and `chart-accounts.ts` applies to
 * the chart: a source somebody archived must not be offered, and a test store's
 * revenue must not reach the live account.
 */
export async function listRoleSources(
  db: Database | Transaction,
  organizationId: string
): Promise<RoleSourceRow[]> {
  const [accounts, storeEvidence, processorEntries, processorTransfers] = await Promise.all([
    db
      .select({
        id: schema.FinancialSourceAccount.id,
        providerKey: schema.FinancialSourceAccount.providerKey,
        externalAccountId: schema.FinancialSourceAccount.externalAccountId,
      })
      .from(schema.FinancialSourceAccount)
      .where(
        and(
          eq(schema.FinancialSourceAccount.organizationId, organizationId),
          eq(schema.FinancialSourceAccount.environment, 'live'),
          isNull(schema.FinancialSourceAccount.archivedAt)
        )
      ),
    db
      .selectDistinct({ id: schema.FinancialSourceObject.sourceAccountId })
      .from(schema.FinancialSourceObject)
      .where(eq(schema.FinancialSourceObject.organizationId, organizationId)),
    db
      .selectDistinct({ id: schema.ProcessorBalanceEntry.sourceAccountId })
      .from(schema.ProcessorBalanceEntry)
      .where(eq(schema.ProcessorBalanceEntry.organizationId, organizationId)),
    db
      .selectDistinct({ id: schema.MoneyTransfer.sourceAccountId })
      .from(schema.MoneyTransfer)
      .where(eq(schema.MoneyTransfer.organizationId, organizationId)),
  ])

  const stores = new Set(storeEvidence.map((row) => row.id))
  const processors = new Set(
    [...processorEntries, ...processorTransfers].map((row) => row.id).filter(Boolean)
  )

  const rows: RoleSourceRow[] = []
  for (const account of accounts) {
    const isManual =
      account.providerKey === MANUAL_SOURCE_PROVIDER_KEY &&
      account.externalAccountId === MANUAL_SOURCE_EXTERNAL_ID
    const axes: ScopeAxis[] = isManual
      ? ['store']
      : [
          ...(stores.has(account.id) ? (['store'] as const) : []),
          ...(processors.has(account.id) ? (['processor'] as const) : []),
        ]
    // A live account nothing has ever sent evidence through carries no axis, so
    // there is no role it could be offered under. Dropped rather than listed
    // under both - a screen offering a source that cannot post is a question
    // with no answer.
    if (axes.length === 0) continue
    rows.push({
      id: account.id,
      providerKey: account.providerKey,
      externalAccountId: account.externalAccountId,
      name: isManual ? MANUAL_SOURCE_LABEL : account.externalAccountId,
      axes,
      isManual,
    })
  }

  return rows.sort((a, b) => {
    if (a.isManual !== b.isManual) return a.isManual ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * The subset of `ids` that are LIVE sources in this org, as a set.
 *
 * What `resolveRoles` checks a scoped assignment against before using it. An org
 * that maps a store and then archives it keeps the assignment row - the FK is
 * to a soft-archived table - and resolution must fall through to the org default
 * rather than post to an account chosen for a source that is gone (47 §12.5).
 */
export async function readLiveSourceAccountIds(
  db: Database | Transaction,
  organizationId: string,
  ids: readonly string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const rows = await db
    .select({ id: schema.FinancialSourceAccount.id })
    .from(schema.FinancialSourceAccount)
    .where(
      and(
        eq(schema.FinancialSourceAccount.organizationId, organizationId),
        inArray(schema.FinancialSourceAccount.id, [...new Set(ids)]),
        eq(schema.FinancialSourceAccount.environment, 'live'),
        isNull(schema.FinancialSourceAccount.archivedAt)
      )
    )
  return new Set(rows.map((row) => row.id))
}
