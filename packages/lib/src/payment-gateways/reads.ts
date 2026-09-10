// packages/lib/src/payment-gateways/reads.ts

/**
 * Every READ over `payment_gateway` records
 * (`plans/accounting/tasks/13-cash-accounts-and-the-qbo-seam.md` §5.3).
 *
 * Reads only. The writes the settings page needs live in `writes.ts`, because
 * a file that both queries and mutates is the first step back toward a
 * service class (`docs/lib-module-guide.md` §5).
 *
 * No permission checks anywhere in this file. The router asserts `ledgerView`
 * or `ledgerControl` and hands the narrowed filters down.
 */

import { type Database, schema } from '@auxx/database'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../cache'
import { UnprocessableEntityError } from '../errors'
import type { FieldOptions } from '../field-values/converters'
import { buildOptionIndex, resolveOptionId } from '../resources/registry/option-helpers'
import { toRecordId } from '../resources/resource-id'
import {
  normaliseGatewayHandle,
  type ObservedGatewayHandle,
  type PaymentGatewayRow,
  RESERVED_GATEWAY_HANDLES,
  resolvePaymentGatewaySettlementSource,
  resolvePaymentGatewayStatus,
} from './client'
import { guard } from './guard'

/** Every `payment_gateway` attribute a {@link PaymentGatewayRow} is assembled from. */
const PAYMENT_GATEWAY_ATTRIBUTES = [
  'payment_gateway_name',
  'payment_gateway_handles',
  'payment_gateway_clearing_account',
  'payment_gateway_fee_account',
  'payment_gateway_settlement_source',
  'payment_gateway_status',
  'payment_gateway_last_settlement_at',
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
  organizationId: string
): Promise<PaymentGatewayFieldContext | null> {
  const paymentGatewayDefId = await getCachedEntityDefId(organizationId, 'payment_gateway')
  if (!paymentGatewayDefId) return null
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...PAYMENT_GATEWAY_ATTRIBUTES])) as PaymentGatewayFields
  // Without `name` and `clearingAccount` there is no gateway at all: the
  // display value and the one thing this entity exists to say are both gone.
  if (!fields.payment_gateway_name || !fields.payment_gateway_clearing_account) return null
  return { paymentGatewayDefId, fields }
}

/** {@link loadPaymentGatewayFieldContext}, as the refusal a write path needs. */
export async function requirePaymentGatewayFieldContext(
  organizationId: string
): Promise<PaymentGatewayFieldContext> {
  const ctx = await loadPaymentGatewayFieldContext(organizationId)
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
  db: Database,
  organizationId: string,
  params: { includeArchived?: boolean } = {}
): Promise<Result<PaymentGatewayRow[], Error>> {
  const { includeArchived = false } = params
  return guard(
    async () => {
      const ctx = await loadPaymentGatewayFieldContext(organizationId)
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
  db: Database,
  organizationId: string,
  paymentGatewayId: string,
  params: { includeArchived?: boolean } = {}
): Promise<Result<PaymentGatewayRow | null, Error>> {
  const { includeArchived = false } = params
  return guard(
    async () => {
      const ctx = await loadPaymentGatewayFieldContext(organizationId)
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
 * route, falls back to `clearing_card`, and the entry balances. Nothing
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
 * Sorted by handle. No order counts - see {@link ObservedGatewayHandle}.
 */
export async function listObservedGatewayHandles(
  db: Database,
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

      // Closed rails included: a closed gateway still routes its own history
      // (`toGatewayRoutes`), so its handles are claimed, not orphaned.
      const gateways = await listPaymentGateways(db, organizationId, { includeArchived: true })
      if (gateways.isErr()) throw gateways.error
      const claimedBy = new Map<string, string>()
      for (const gateway of gateways.value) {
        for (const handle of gateway.handles) {
          const key = normaliseGatewayHandle(handle)
          if (key && !claimedBy.has(key)) claimedBy.set(key, gateway.id)
        }
      }

      const options = buildOptionIndex(((field.options ?? {}) as FieldOptions).options ?? [])
      const reserved = new Set(RESERVED_GATEWAY_HANDLES)
      const seen = new Map<string, ObservedGatewayHandle>()
      for (const row of rows) {
        const stored = row.optionId ?? row.valueText
        if (!stored) continue
        const resolved = resolveOptionId(stored, options)
        const handle = (resolved.status === 'known' ? resolved.label : resolved.raw).trim()
        const key = normaliseGatewayHandle(handle)
        if (!key || reserved.has(key) || seen.has(key)) continue
        seen.set(key, { handle, claimedBy: claimedBy.get(key) ?? null })
      }

      return [...seen.values()].sort((a, b) => a.handle.localeCompare(b.handle))
    },
    "Failed to read the gateway handles on this organization's orders",
    { organizationId }
  )
}

/**
 * Turn a page of payment-gateway instance ids into full rows with exactly one
 * query for their field values.
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
  db: Database,
  organizationId: string,
  ctx: PaymentGatewayFieldContext,
  page: { id: string; createdAt: Date | null; updatedAt: Date | null }[]
): Promise<PaymentGatewayRow[]> {
  const ids = page.map((row) => row.id)
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
    return {
      id: row.id,
      recordId: toRecordId(ctx.paymentGatewayDefId, row.id),
      name: readOne(row.id, 'payment_gateway_name')?.valueText ?? '',
      handles: readMany(row.id, 'payment_gateway_handles')
        .map((value) => value.optionId ?? value.valueText)
        .filter((handle): handle is string => !!handle),
      clearingGlAccountId: readOne(row.id, 'payment_gateway_clearing_account')?.valueText ?? '',
      feeGlAccountId: readOne(row.id, 'payment_gateway_fee_account')?.valueText ?? null,
      settlementSource: resolvePaymentGatewaySettlementSource(
        readOne(row.id, 'payment_gateway_settlement_source')?.optionId
      ),
      status: resolvePaymentGatewayStatus(readOne(row.id, 'payment_gateway_status')?.optionId),
      lastSettlementAt: lastSettlementAt ? lastSettlementAt.slice(0, 10) : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    } satisfies PaymentGatewayRow
  })
}
