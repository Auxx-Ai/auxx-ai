// packages/lib/src/accounting/ledger/roles/source-scope.ts

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
 * which is true. The translation from null to the manual row happens in exactly one
 * place, on the resolution side, in `resolve-roles.ts` (47 §3.2).
 *
 * No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
// Reaches the same `payment_gateway` records `assertScopableGateway` in
// `role-map.ts` reads through - the rail axis is a live gateway now, not
// evidence (58 §3 rule 6).
import { listPaymentGateways } from '../../rails/reads'
import type { ScopeAxis } from '../builders/entry'
// 🛑 `RoleSourceRow` lives in `types.ts`, which is client-safe: a settings
// screen holds the shape and this file reaches a database. Re-exported so a
// server caller still gets it from the module that produces it.
import { sourceAccountLabel } from '../chart/source-account-label'
import { MANUAL_SOURCE_EXTERNAL_ID, MANUAL_SOURCE_PROVIDER_KEY, type RoleSourceRow } from '../types'

export type { RoleSourceRow } from '../types'

/**
 * The manual bucket's identity and label.
 *
 * 🛑 DEFINED in `types.ts`, not here, and re-exported for the same reason
 * `RoleSourceRow` is: this file reaches a database and `types.ts` is client-safe.
 * A badge naming a source account has to recognise the manual bucket in the
 * browser. A server caller still gets all three from the module that mints the
 * row, which is what this line is for.
 *
 * Synder made the same call on the namespace itself: their provider enum carries
 * `CUSTOM`, `SYNDER` and `EXTERNAL_URL` beside `SHOPIFY` and `STRIPE`.
 */
export {
  MANUAL_SOURCE_EXTERNAL_ID,
  MANUAL_SOURCE_LABEL,
  MANUAL_SOURCE_PROVIDER_KEY,
} from '../types'

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
 * The `FinancialSourceObject.objectType`s that prove an account is a STOREFRONT.
 *
 * 🛑 A whitelist, not "everything that is not a processor type". The same table
 * holds both sides: a Shopify Payments account carries `balance_transaction` and
 * `payout` rows and NOT ONE order, so an unfiltered `FinancialSourceObject`
 * lookup reads it as a storefront and offers a bookkeeper a payment processor to
 * book product revenue to - exactly what task 47 §7.4 forbids. Worse, the
 * override it lets somebody save is DEAD: a fulfillment's `sourceStoreId`
 * resolves to the store account, never the payments account, so the scoped row
 * can never match and the revenue quietly keeps using the org default.
 *
 * ⚠️ Fail closed. A new object type is not a storefront until it is named here,
 * because the cost of a missing row (a store that has to be mapped by someone
 * noticing) is smaller than the cost of an extra one (a mapping that silently
 * does nothing).
 *
 * Written by `customer-money/record-evidence.ts` (`order_transaction`) and
 * `customer-money/adopt-native-stripe.ts` (`charge`, `refund`). The processor
 * object types - `balance_transaction`, `payout` - are deliberately absent:
 * before task 58 they were what the `rail` axis read; now `rail` is a live
 * `payment_gateway` record (§3 rule 6), never evidence on this table at all,
 * so a row carrying them earns no axis here any more.
 */
const STORE_EVIDENCE_OBJECT_TYPES = ['order_transaction', 'charge', 'refund'] as const

/**
 * Every live source this org's role map may be scoped to, manual pinned first -
 * `store`-axis rows from `FinancialSourceAccount` evidence, `rail`-axis rows
 * from the org's own `payment_gateway` records (58 §3 rule 6). Two tables, two
 * id spaces, one list: `RoleSourceRow.id` is a `FinancialSourceAccount.id` for
 * the first kind and a `payment_gateway` EntityInstance id for the second, and
 * a caller tells them apart by `axes` - a `rail` row is never also a `store`.
 *
 * 🛑 **Every live source and every live rail gets a row, always**, including
 * the ones that inherit the org default. An unconfigured store or rail must be
 * VISIBLE rather than absent - "Amazon US is using 4000 Product Revenue" is
 * the fact the screen exists to surface, and a screen that only listed
 * overrides could never say it.
 *
 * Sorted manual first, then by name. Sorting by `providerKey` would bury `auxx`
 * between `amazon` and `shopify`, which is a sort order that hides the one row
 * every org has.
 *
 * Archived and non-`live` accounts, and archived gateways, are excluded IN THE
 * QUERY, the same rule `chart-accounts.ts` applies to the chart: a source somebody archived must
 * not be offered, and a test store's revenue must not reach the live account.
 */
export async function listRoleSources(
  db: Database | Transaction,
  organizationId: string
): Promise<RoleSourceRow[]> {
  const [accounts, storeEvidence, gatewaysResult] = await Promise.all([
    db
      .select({
        id: schema.FinancialSourceAccount.id,
        providerKey: schema.FinancialSourceAccount.providerKey,
        externalAccountId: schema.FinancialSourceAccount.externalAccountId,
        name: schema.FinancialSourceAccount.name,
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
      .where(
        and(
          eq(schema.FinancialSourceObject.organizationId, organizationId),
          inArray(schema.FinancialSourceObject.objectType, [...STORE_EVIDENCE_OBJECT_TYPES])
        )
      ),
    listPaymentGateways(db, organizationId),
  ])
  if (gatewaysResult.isErr()) throw gatewaysResult.error

  const stores = new Set(storeEvidence.map((row) => row.id))

  const rows: RoleSourceRow[] = []
  for (const account of accounts) {
    const isManual =
      account.providerKey === MANUAL_SOURCE_PROVIDER_KEY &&
      account.externalAccountId === MANUAL_SOURCE_EXTERNAL_ID
    const axes: ScopeAxis[] = isManual || stores.has(account.id) ? ['store'] : []
    // A live account with no store evidence at all carries no axis, so there is
    // no role it could be offered under. Dropped rather than listed anyway - a
    // screen offering a source that cannot post is a question with no answer.
    if (axes.length === 0) continue
    rows.push({
      id: account.id,
      providerKey: account.providerKey,
      externalAccountId: account.externalAccountId,
      name: sourceAccountLabel(account),
      axes,
      isManual,
    })
  }

  // Every live rail is its own row, always `['rail']` - a gateway is never
  // also a store, whatever evidence its linked feed happens to carry.
  for (const gateway of gatewaysResult.value) {
    rows.push({
      id: gateway.id,
      providerKey: 'payment_gateway',
      externalAccountId: gateway.id,
      name: gateway.name,
      axes: ['rail'],
      isManual: false,
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
