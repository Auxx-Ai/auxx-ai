// packages/lib/src/payment-gateways/reads.ts

/**
 * Every READ over `payment_gateway` records
 * (`plans/accounting/tasks/done/13-cash-accounts-and-the-qbo-seam.md` §5.3).
 *
 * Reads only. The writes the settings page needs live in `writes.ts`, because
 * a file that both queries and mutates is the first step back toward a
 * service class (`docs/lib-module-guide.md` §5).
 *
 * No permission checks anywhere in this file. The router asserts `ledgerView`
 * or `ledgerControl` and hands the narrowed filters down.
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../cache'
import { UnprocessableEntityError } from '../errors'
import type { FieldOptions } from '../field-values/converters'
import { ACCOUNT_ROLES } from '../postings/build-entry'
import { readRoleAssignments } from '../postings/role-assignments'
import { buildOptionIndex, resolveOptionId } from '../resources/registry/option-helpers'
import { toRecordId } from '../resources/resource-id'
import { systemDefId, systemFieldMap } from '../resources/system-records'
import {
  type GatewayHandleCensusRow,
  normaliseGatewayHandle,
  type ObservedGatewayHandle,
  type PaymentGatewayRow,
  RESERVED_GATEWAY_HANDLES,
  resolvePaymentGatewayFeeTreatment,
  resolvePaymentGatewaySettlementSource,
  resolvePaymentGatewayStatus,
} from './client'
import { guard } from './guard'

/**
 * Every `payment_gateway` attribute a {@link PaymentGatewayRow} is assembled from.
 *
 * §4.3 removed six fields this used to name (`clearingAccount`, `feeAccount`,
 * `settlementSource`, `settlementAccount`, `settlementCurrency`,
 * `settlementBankAccount`) - what they answered now comes from the rail scope
 * (`GlRoleAssignment.paymentGatewayId`) and the linked feed, both read in
 * {@link hydratePaymentGateways}, never from a `FieldValue` on this record.
 */
const PAYMENT_GATEWAY_ATTRIBUTES = [
  'payment_gateway_name',
  'payment_gateway_handles',
  'payment_gateway_fee_treatment',
  'payment_gateway_status',
  'payment_gateway_last_settlement_at',
  'payment_gateway_last_fee_booked_at',
] as const

type PaymentGatewayAttribute = (typeof PAYMENT_GATEWAY_ATTRIBUTES)[number]
type PaymentGatewayFields = Record<PaymentGatewayAttribute, { id: string } | null>

/** The resolved def and field ids every payment-gateway read needs. */
export interface PaymentGatewayFieldContext {
  paymentGatewayDefId: string
  fields: PaymentGatewayFields
}

/**
 * Resolve the `payment_gateway` def and its fields, or `null` when the org has
 * not run entity migration 146 yet.
 *
 * `null` rather than a throw so a caller that only wants to know whether the
 * feature is provisioned (the fulfillment planner, which has nothing to route
 * without it) gets an empty answer instead of a 500. Write paths call
 * {@link requirePaymentGatewayFieldContext} instead.
 */
export async function loadPaymentGatewayFieldContext(
  organizationId: string,
  db?: Database | Transaction
): Promise<PaymentGatewayFieldContext | null> {
  const paymentGatewayDefId = await systemDefId(db, organizationId, 'payment_gateway')
  if (!paymentGatewayDefId) return null
  const fields = (await systemFieldMap(
    db,
    organizationId,
    PAYMENT_GATEWAY_ATTRIBUTES
  )) as PaymentGatewayFields
  // Without `name` there is no gateway at all: the display value is the one
  // thing every row must carry. `clearingAccount` used to gate this too, but
  // §4.3 removed it from the record - the rail scope answers that now.
  if (!fields.payment_gateway_name) return null
  return { paymentGatewayDefId, fields }
}

/** {@link loadPaymentGatewayFieldContext}, as the refusal a write path needs. */
export async function requirePaymentGatewayFieldContext(
  organizationId: string,
  db?: Database | Transaction
): Promise<PaymentGatewayFieldContext> {
  const ctx = await loadPaymentGatewayFieldContext(organizationId, db)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Payment gateways are not available until the payment_gateway entity and its fields are ' +
        'provisioned (entity migration 146)'
    )
  }
  return ctx
}

/**
 * Every payment gateway in the org, oldest first.
 *
 * ⚠️ **One query for the instances, one for their field values.** Never one
 * per row - a handful of gateways is the normal case, but there is no reason
 * this should degrade linearly for the org that adds a tenth.
 */
export async function listPaymentGateways(
  db: Database | Transaction,
  organizationId: string,
  params: { includeArchived?: boolean } = {}
): Promise<Result<PaymentGatewayRow[], Error>> {
  const { includeArchived = false } = params
  return guard(
    async () => {
      const ctx = await loadPaymentGatewayFieldContext(organizationId, db)
      if (!ctx) return []

      const instances = await db
        .select({
          id: schema.EntityInstance.id,
          createdAt: schema.EntityInstance.createdAt,
          updatedAt: schema.EntityInstance.updatedAt,
        })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, ctx.paymentGatewayDefId),
            ...(includeArchived ? [] : [isNull(schema.EntityInstance.archivedAt)])
          )
        )
        .orderBy(asc(schema.EntityInstance.createdAt))

      if (instances.length === 0) return []
      return hydratePaymentGateways(db, organizationId, ctx, instances)
    },
    'Failed to list payment gateways',
    { organizationId }
  )
}

/**
 * One payment gateway by id, or `null` when it does not exist, is archived, or
 * belongs to another org.
 */
export async function getPaymentGateway(
  db: Database | Transaction,
  organizationId: string,
  paymentGatewayId: string,
  params: { includeArchived?: boolean } = {}
): Promise<Result<PaymentGatewayRow | null, Error>> {
  const { includeArchived = false } = params
  return guard(
    async () => {
      const ctx = await loadPaymentGatewayFieldContext(organizationId, db)
      if (!ctx) return null

      const [instance] = await db
        .select({
          id: schema.EntityInstance.id,
          createdAt: schema.EntityInstance.createdAt,
          updatedAt: schema.EntityInstance.updatedAt,
        })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.id, paymentGatewayId),
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, ctx.paymentGatewayDefId),
            ...(includeArchived ? [] : [isNull(schema.EntityInstance.archivedAt)])
          )
        )
        .limit(1)

      if (!instance) return null
      const [row] = await hydratePaymentGateways(db, organizationId, ctx, [instance])
      return row ?? null
    },
    'Failed to read payment gateway',
    { organizationId, paymentGatewayId }
  )
}

/**
 * Every gateway handle that actually appears on this org's orders, and whether
 * a `payment_gateway` record already routes it.
 *
 * ## Why this read exists
 *
 * `handles` is a free-text field, and a handle that does not match what
 * Shopify wrote on the order is INVISIBLE: `resolveFulfillmentDebit` finds no
 * route, falls back to `clearing`, and the entry balances. Nothing
 * downstream can tell a typo from a rail that legitimately has no record yet.
 * Before this, the only way to learn the real strings was to query
 * `order_payment_gateways` by hand - so the "add a gateway" screen asked a
 * person to type a value they had no way to look up. This is that lookup.
 *
 * ## The stored shape
 *
 * ⚠️ `order_payment_gateways` is an OPEN, value-keyed TAGS field: one
 * `FieldValue` row per gateway per order, and a free-text tag is written with
 * its own text AS the `optionId`. `valueText` is the defensive fallback, and
 * the connector-provisioned case puts a real option key there instead - which
 * is why every value goes through {@link resolveOptionId} against the field's
 * own option list, exactly as `readOrderFacts`
 * (`money/fulfillment-posting/reads.ts`) does. Grouping on `valueText` alone
 * silently misses every order whose handle resolved to an option row.
 *
 * De-duplicated case-insensitively with {@link normaliseGatewayHandle} - the
 * same normaliser the matcher uses, so a handle this read offers always
 * matches. The RAW spelling is what comes back, because that is what a person
 * should see and what the option list stores.
 *
 * {@link RESERVED_GATEWAY_HANDLES} are dropped: `manual` and `bogus` are
 * answered by the debit fork before any route is consulted, so reporting them
 * as unclaimed would be noise that never goes away.
 *
 * Sorted by handle. No order counts - see {@link ObservedGatewayHandle}, and
 * {@link listGatewayHandleCensus} for the setup-screen read that pays for them.
 */
export async function listObservedGatewayHandles(
  db: Database | Transaction,
  organizationId: string
): Promise<Result<ObservedGatewayHandle[], Error>> {
  return guard(
    async () => {
      const fields = await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes(['order_payment_gateways'])
      const field = fields.order_payment_gateways
      if (!field) return []

      const rows = await db
        .selectDistinct({
          optionId: schema.FieldValue.optionId,
          valueText: schema.FieldValue.valueText,
        })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.fieldId, field.id)
          )
        )
      if (rows.length === 0) return []

      const claimedBy = await readHandleClaims(db, organizationId)
      const readHandle = handleReader(field.options)
      const seen = new Map<string, ObservedGatewayHandle>()
      for (const row of rows) {
        const handle = readHandle(row)
        if (!handle) continue
        const key = normaliseGatewayHandle(handle)
        if (seen.has(key)) continue
        seen.set(key, { handle, claimedBy: claimedBy.get(key) ?? null })
      }

      return [...seen.values()].sort((a, b) => a.handle.localeCompare(b.handle))
    },
    "Failed to read the gateway handles on this organization's orders",
    { organizationId }
  )
}

/**
 * {@link listObservedGatewayHandles}, plus the order count and last-seen date
 * the setup wizard's rail page needs
 * (`plans/accounting/tasks/26-a-clearing-account-per-rail.md` §8 item 1).
 *
 * ## 🛑 A SECOND export, not a widening of the first
 *
 * The settings list reads the cheap `selectDistinct` above and must keep
 * reading it. The counts here are a `GROUP BY` on the same rows, but the
 * last-seen date is a second join to the order's `placedAt` value - and that is
 * a cost the "is this handle routed?" question on the settings screen should
 * not pay on every render. See {@link GatewayHandleCensusRow} for why a setup
 * screen genuinely needs both numbers where the settings list genuinely does
 * not.
 *
 * ⚠️ **Rows merge on the NORMALISED handle**, so `'Affirm'` and `'affirm'` are
 * one census row whose count is the sum and whose date is the later of the two.
 * `authorize_net` and `authorize.net` do NOT merge here - they are different
 * strings under the same normaliser, and grouping them is a claim about the
 * RAIL rather than about the handle. §8 item 2's merge is the caller's, made
 * against the suggestion catalogue.
 *
 * ⚠️ An org with no `order_placed_at` field provisioned gets every
 * `lastSeenAt` as null rather than a refusal: a missing date field is a reason
 * to say less on a setup page, never a reason to hide the census.
 */
export async function listGatewayHandleCensus(
  db: Database | Transaction,
  organizationId: string
): Promise<Result<GatewayHandleCensusRow[], Error>> {
  return guard(
    async () => {
      const fields = await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes(['order_payment_gateways', 'order_placed_at'])
      const field = fields.order_payment_gateways
      if (!field) return []
      const placedAtFieldId = fields.order_placed_at?.id ?? null

      const placedAt = alias(schema.FieldValue, 'order_placed_at_value')
      const rows = await db
        .select({
          optionId: schema.FieldValue.optionId,
          valueText: schema.FieldValue.valueText,
          // `::int` because `count` is a bigint and the driver hands those back
          // as strings; `to_char(... at time zone 'UTC')` because `max` over a
          // `timestamptz` bypasses Drizzle's own column mapping and would
          // otherwise arrive as whatever the driver felt like. Both are read
          // back through `Number`/a plain string below, never trusted raw.
          orderCount: sql<number>`count(distinct ${schema.FieldValue.entityId})::int`,
          lastSeenAt: sql<
            string | null
          >`to_char(max(${placedAt.valueDate}) at time zone 'UTC', 'YYYY-MM-DD')`,
        })
        .from(schema.FieldValue)
        .leftJoin(
          placedAt,
          placedAtFieldId
            ? and(
                eq(placedAt.entityId, schema.FieldValue.entityId),
                eq(placedAt.organizationId, schema.FieldValue.organizationId),
                eq(placedAt.fieldId, placedAtFieldId)
              )
            : sql`false`
        )
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.fieldId, field.id)
          )
        )
        .groupBy(schema.FieldValue.optionId, schema.FieldValue.valueText)
      if (rows.length === 0) return []

      const claimedBy = await readHandleClaims(db, organizationId)
      const readHandle = handleReader(field.options)
      const merged = new Map<string, GatewayHandleCensusRow>()
      for (const row of rows) {
        const handle = readHandle(row)
        if (!handle) continue
        const key = normaliseGatewayHandle(handle)
        const orderCount = Number(row.orderCount) || 0
        const existing = merged.get(key)
        if (!existing) {
          merged.set(key, {
            handle,
            claimedBy: claimedBy.get(key) ?? null,
            orderCount,
            lastSeenAt: row.lastSeenAt ?? null,
          })
          continue
        }
        existing.orderCount += orderCount
        // String comparison is a date comparison for `YYYY-MM-DD`.
        if (row.lastSeenAt && (!existing.lastSeenAt || row.lastSeenAt > existing.lastSeenAt)) {
          existing.lastSeenAt = row.lastSeenAt
        }
      }

      // Busiest rail first: on a setup screen the rail carrying the history is
      // the one whose account matters most, and alphabetical buries it.
      return [...merged.values()].sort(
        (a, b) => b.orderCount - a.orderCount || a.handle.localeCompare(b.handle)
      )
    },
    "Failed to read the gateway handle census on this organization's orders",
    { organizationId }
  )
}

/**
 * Normalised handle -> the `payment_gateway` id claiming it.
 *
 * Closed rails included: a closed gateway still routes its own history
 * (`toGatewayRoutes`), so its handles are claimed, not orphaned.
 *
 * 🛑 Shared by both census reads deliberately. Two copies of "who claims this
 * handle" that drifted would let one screen report a handle as unrouted while
 * the other reported it routed, over the same database.
 */
async function readHandleClaims(
  db: Database | Transaction,
  organizationId: string
): Promise<Map<string, string>> {
  const gateways = await listPaymentGateways(db, organizationId, { includeArchived: true })
  if (gateways.isErr()) throw gateways.error
  const claimedBy = new Map<string, string>()
  for (const gateway of gateways.value) {
    for (const handle of gateway.handles) {
      const key = normaliseGatewayHandle(handle)
      if (key && !claimedBy.has(key)) claimedBy.set(key, gateway.id)
    }
  }
  return claimedBy
}

/**
 * Turn one stored `order_payment_gateways` value into the RAW handle a person
 * should see, or `''` for a value no census may report.
 *
 * Every value goes through {@link resolveOptionId} against the field's own
 * option list, exactly as `readOrderFacts` (`money/fulfillment-posting/reads.ts`)
 * does: a free-text tag is written with its own text AS the `optionId`, and the
 * connector-provisioned case puts a real option key there instead. Reading
 * `valueText` alone silently misses every order whose handle resolved to an
 * option row.
 *
 * {@link RESERVED_GATEWAY_HANDLES} answer to `''`: `manual` and `bogus` are
 * settled by the debit fork before any route is consulted, so reporting them as
 * unclaimed would be noise that never goes away.
 *
 * 🛑 Shared by both census reads, same argument as {@link readHandleClaims} -
 * two resolvers that disagreed would offer a handle on one screen that the
 * other screen cannot see.
 */
function handleReader(
  fieldOptions: unknown
): (row: { optionId: string | null; valueText: string | null }) => string {
  const options = buildOptionIndex(((fieldOptions ?? {}) as FieldOptions).options ?? [])
  const reserved = new Set(RESERVED_GATEWAY_HANDLES)
  return (row) => {
    const stored = row.optionId ?? row.valueText
    if (!stored) return ''
    const resolved = resolveOptionId(stored, options)
    const handle = (resolved.status === 'known' ? resolved.label : resolved.raw).trim()
    const key = normaliseGatewayHandle(handle)
    return !key || reserved.has(key) ? '' : handle
  }
}

/**
 * One rail's `clearing`/`payment_processing_fees` accounts, resolved through the
 * rail scope (task 58 §3) rather than read off the record - see {@link readGatewayRailAccounts}.
 */
interface GatewayRailAccounts {
  clearingGlAccountId: string
  feeGlAccountId: string | null
  /** A currency named by one of this rail's own rows, if any - there is no longer one answer. */
  currency: string | null
}

/**
 * Every gateway's `clearing`/`payment_processing_fees` mapping, read once through the
 * `GlRoleAssignment` seam (§4.9) and filtered in memory - the same "one decode, callers own
 * their output shape" argument `readRoleAssignments`'s own header makes.
 *
 * Preference within a rail: the no-currency row first (the rail's default), then the first
 * currency-scoped row - `PaymentGatewayRow` has room for one answer per role, and a screen that
 * needs every currency reads `GlRoleAssignment` itself (58 §6, U8).
 */
async function readGatewayRailAccounts(
  db: Database | Transaction,
  organizationId: string
): Promise<Map<string, GatewayRailAccounts>> {
  const assignments = await readRoleAssignments(db, organizationId)
  const byGateway = new Map<string, GatewayRailAccounts>()
  for (const row of assignments) {
    if (!row.paymentGatewayId || row.markedUnused) continue
    if (row.role !== ACCOUNT_ROLES.CLEARING && row.role !== ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES)
      continue
    const entry = byGateway.get(row.paymentGatewayId) ?? {
      clearingGlAccountId: '',
      feeGlAccountId: null,
      currency: null,
    }
    // The no-currency row wins whenever one exists; otherwise the first currency row seen stands.
    if (
      row.role === ACCOUNT_ROLES.CLEARING &&
      (!entry.clearingGlAccountId || row.currency == null)
    ) {
      entry.clearingGlAccountId = row.glAccountId
    }
    if (
      row.role === ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES &&
      (!entry.feeGlAccountId || row.currency == null)
    ) {
      entry.feeGlAccountId = row.glAccountId
    }
    if (row.currency && !entry.currency) entry.currency = row.currency
    byGateway.set(row.paymentGatewayId, entry)
  }
  return byGateway
}

/** One live feed linked to a rail, for the settlement-source/merchant-id derivation below. */
interface GatewayLinkedFeed {
  providerKey: string
  externalAccountId: string
}

/** Every gateway's linked feed (task 58 §5.5), first live match per rail. */
async function readGatewayLinkedFeeds(
  db: Database | Transaction,
  organizationId: string,
  paymentGatewayIds: readonly string[]
): Promise<Map<string, GatewayLinkedFeed>> {
  const byGateway = new Map<string, GatewayLinkedFeed>()
  if (paymentGatewayIds.length === 0) return byGateway
  const rows = await db
    .select({
      paymentGatewayId: schema.FinancialSourceAccount.paymentGatewayId,
      providerKey: schema.FinancialSourceAccount.providerKey,
      externalAccountId: schema.FinancialSourceAccount.externalAccountId,
    })
    .from(schema.FinancialSourceAccount)
    .where(
      and(
        eq(schema.FinancialSourceAccount.organizationId, organizationId),
        inArray(schema.FinancialSourceAccount.paymentGatewayId, [...paymentGatewayIds]),
        isNull(schema.FinancialSourceAccount.archivedAt)
      )
    )
  for (const row of rows) {
    if (!row.paymentGatewayId || byGateway.has(row.paymentGatewayId)) continue
    byGateway.set(row.paymentGatewayId, {
      providerKey: row.providerKey,
      externalAccountId: row.externalAccountId,
    })
  }
  return byGateway
}

/**
 * Turn a page of payment-gateway instance ids into full rows with exactly one
 * query for their field values, one for their rail-scoped role rows and one for
 * their linked feeds.
 *
 * `handles` is the one multi-value field here (TAGS - one `FieldValue` row per
 * handle), so this groups values by `(entityId, fieldId)` into arrays rather
 * than the single-row-per-field map {@link listBankAccounts}'s hydrate uses.
 * Free-text tags (`options: { options: [] }`, the same shape
 * `order_payment_gateways` declares) are written with the typed text AS the
 * `optionId` - `valueText` is read as a defensive fallback only, mirroring
 * `readOrderFacts` in `money/fulfillment-posting/reads.ts`.
 */
async function hydratePaymentGateways(
  db: Database | Transaction,
  organizationId: string,
  ctx: PaymentGatewayFieldContext,
  page: { id: string; createdAt: Date | null; updatedAt: Date | null }[]
): Promise<PaymentGatewayRow[]> {
  const ids = page.map((row) => row.id)
  const [railAccounts, linkedFeeds] = await Promise.all([
    readGatewayRailAccounts(db, organizationId),
    readGatewayLinkedFeeds(db, organizationId, ids),
  ])
  const fieldIds = Object.values(ctx.fields)
    .filter((field): field is { id: string } => field != null)
    .map((field) => field.id)

  const values = fieldIds.length
    ? await db
        .select({
          entityId: schema.FieldValue.entityId,
          fieldId: schema.FieldValue.fieldId,
          valueText: schema.FieldValue.valueText,
          valueDate: schema.FieldValue.valueDate,
          relatedEntityId: schema.FieldValue.relatedEntityId,
          optionId: schema.FieldValue.optionId,
        })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            inArray(schema.FieldValue.entityId, ids),
            inArray(schema.FieldValue.fieldId, fieldIds)
          )
        )
    : []

  const byInstance = new Map<string, Map<string, (typeof values)[number][]>>()
  for (const value of values) {
    let bucket = byInstance.get(value.entityId)
    if (!bucket) {
      bucket = new Map()
      byInstance.set(value.entityId, bucket)
    }
    const rows = bucket.get(value.fieldId) ?? []
    rows.push(value)
    bucket.set(value.fieldId, rows)
  }

  const readOne = (instanceId: string, attr: PaymentGatewayAttribute) => {
    const id = ctx.fields[attr]?.id
    return id ? (byInstance.get(instanceId)?.get(id)?.[0] ?? null) : null
  }
  const readMany = (instanceId: string, attr: PaymentGatewayAttribute) => {
    const id = ctx.fields[attr]?.id
    return id ? (byInstance.get(instanceId)?.get(id) ?? []) : []
  }

  return page.map((row) => {
    const lastSettlementAt = readOne(row.id, 'payment_gateway_last_settlement_at')?.valueDate
    const lastFeeBookedAt = readOne(row.id, 'payment_gateway_last_fee_booked_at')?.valueDate
    const rail = railAccounts.get(row.id)
    const feed = linkedFeeds.get(row.id)
    return {
      id: row.id,
      recordId: toRecordId(ctx.paymentGatewayDefId, row.id),
      name: readOne(row.id, 'payment_gateway_name')?.valueText ?? '',
      handles: readMany(row.id, 'payment_gateway_handles')
        .map((value) => value.optionId ?? value.valueText)
        .filter((handle): handle is string => !!handle),
      clearingGlAccountId: rail?.clearingGlAccountId ?? '',
      feeGlAccountId: rail?.feeGlAccountId ?? null,
      // §5.5: no stored enum - "manual" for a rail nothing has linked yet.
      settlementSource: resolvePaymentGatewaySettlementSource(feed?.providerKey),
      processorAccountId: feed?.externalAccountId ?? null,
      settlementCurrency: rail?.currency ?? null,
      // §3: `bank` resolves to a `gl_account`, not a `bank_account` record - see
      // `payment-gateways/feeds.ts` for the rail's actual bank mapping.
      bankAccountId: null,
      // 🛑 An org short of migration 156 has no option row here, and
      // `resolvePaymentGatewayFeeTreatment` answers `netted` for it - which is
      // exactly the entry `buildPayoutEntry` has always produced. Defaulting the
      // other way would silently drop the fee leg off every unanswered rail.
      feeTreatment: resolvePaymentGatewayFeeTreatment(
        readOne(row.id, 'payment_gateway_fee_treatment')?.optionId
      ),
      status: resolvePaymentGatewayStatus(readOne(row.id, 'payment_gateway_status')?.optionId),
      lastSettlementAt: lastSettlementAt ? lastSettlementAt.slice(0, 10) : null,
      lastFeeBookedAt: lastFeeBookedAt ? lastFeeBookedAt.slice(0, 10) : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    } satisfies PaymentGatewayRow
  })
}
