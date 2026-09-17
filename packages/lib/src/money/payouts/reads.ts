// packages/lib/src/money/payouts/reads.ts

/**
 * Every READ over payouts.
 *
 * Reads only. The writes live in `sync.ts`, because a file that both queries and
 * mutates is the first step back toward a service class
 * (`docs/lib-module-guide.md` §5).
 *
 * No permission checks anywhere in this file - the router asserts `ledgerView`
 * and hands the narrowed filters down (§6).
 */

import { type Database, schema } from '@auxx/database'
import { and, desc, eq, gt, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { UnprocessableEntityError } from '../../errors'
import { toRecordId } from '../../resources/resource-id'
import { resolvePayoutStatus } from './client'
import { guard } from './guard'
import { loadPayoutSourceSummaries, PAYOUT_SOURCE_ATTRIBUTES } from './source-reads'
import type { ListPayoutsFilters, PayoutRecord, PayoutSourceValue } from './types'

/** Every `payout` attribute a {@link PayoutRecord} is assembled from. */
const PAYOUT_ATTRIBUTES = [
  ...PAYOUT_SOURCE_ATTRIBUTES,
  'payout_number',
  'payout_gateway_id',
  'payout_status',
  'payout_paid_at',
  'payout_currency',
  'payout_deposited',
  'payout_gross',
  'payout_fees',
  'payout_net',
  'payout_unrecognised_net',
  'payout_unrecognised_count',
  'payout_gl_posting_id',
  'payout_blocked_reason',
  'payout_bank_transaction_id',
  'payout_payment_gateway',
  'payout_bank_account',
  'payout_source',
  'payout_destination_mismatch',
] as const

type PayoutAttribute = (typeof PAYOUT_ATTRIBUTES)[number]
type PayoutFields = Record<PayoutAttribute, { id: string } | null>

const DEFAULT_LIMIT = 100

/** The resolved def and field ids every payout read and write needs. */
export interface PayoutFieldContext {
  payoutDefId: string
  fields: PayoutFields
}

/**
 * Resolve the `payout` def and its fields, or `null` when the org has not run
 * entity migration 133 yet.
 *
 * `null` rather than a throw so a list surface on an unmigrated org renders
 * empty instead of 500ing. The WRITE path calls
 * {@link requirePayoutFieldContext}: a sync that silently did nothing would be
 * worse than a refusal, because the clearing account would keep filling and
 * nobody would be told why.
 */
export async function loadPayoutFieldContext(
  organizationId: string
): Promise<PayoutFieldContext | null> {
  const payoutDefId = await getCachedEntityDefId(organizationId, 'payout')
  if (!payoutDefId) return null
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...PAYOUT_ATTRIBUTES])) as PayoutFields
  // Without the gateway id there is no idempotency key, and without the status
  // there is nothing to transition. Either missing means the def is half-seeded.
  if (!fields.payout_gateway_id || !fields.payout_status) return null
  return { payoutDefId, fields }
}

/** {@link loadPayoutFieldContext}, as the refusal a write path needs. */
export async function requirePayoutFieldContext(
  organizationId: string
): Promise<PayoutFieldContext> {
  const ctx = await loadPayoutFieldContext(organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Payouts are not available until the payout entity and its fields are provisioned ' +
        '(entity migration 133)'
    )
  }
  return ctx
}

/** One live feed linked to a rail (task 58 §5.5): a `FinancialSourceAccount` a person has pointed at a `payment_gateway`. */
export interface LinkedFeedAccount {
  id: string
  externalAccountId: string
  /** The `payment_gateway` `EntityInstance` id this feed settles for. Never null - see the query below. */
  paymentGatewayId: string
}

/**
 * Every live `FinancialSourceAccount` of one `providerKey` that a person has
 * linked to a rail, for one org.
 *
 * THE discovery query for a `PayoutSource`'s `resolveContexts` (task 58 §5.5):
 * a context is built per row this returns, one context per feed, never
 * filtered by the retired `settlementSource` enum. A feed nothing has linked
 * yet (`paymentGatewayId IS NULL`) is a manual rail and never reaches this
 * list - linking it is a person's act (§6.2), not a default this file guesses.
 */
export async function listLinkedFeedAccounts(
  db: Database,
  organizationId: string,
  providerKey: string
): Promise<LinkedFeedAccount[]> {
  const rows = await db
    .select({
      id: schema.FinancialSourceAccount.id,
      externalAccountId: schema.FinancialSourceAccount.externalAccountId,
      paymentGatewayId: schema.FinancialSourceAccount.paymentGatewayId,
    })
    .from(schema.FinancialSourceAccount)
    .where(
      and(
        eq(schema.FinancialSourceAccount.organizationId, organizationId),
        eq(schema.FinancialSourceAccount.providerKey, providerKey),
        isNotNull(schema.FinancialSourceAccount.paymentGatewayId),
        isNull(schema.FinancialSourceAccount.archivedAt)
      )
    )
  return rows.flatMap((row) =>
    row.paymentGatewayId
      ? [
          {
            id: row.id,
            externalAccountId: row.externalAccountId,
            paymentGatewayId: row.paymentGatewayId,
          },
        ]
      : []
  )
}

/**
 * The payout row for one gateway payout id on one rail, or `null`.
 *
 * 🛑 THE idempotency check for the sync, which is a poll and sees every payout
 * again on every run. It reads the record rather than trusting a watermark
 * alone: a watermark can be re-run, reset, or overlap a boundary, and a second
 * posting of the same payout would relieve clearing twice.
 *
 * ## The key is the PAIR (brief 27 §6.4)
 *
 * `paymentGatewayId` is the `payment_gateway` record the caller is reading for.
 * Two providers can reuse an id format, so the same `providerPayoutId` on two
 * rails is two rows, and this matches `payout_gateway_id` AND
 * `payout_payment_gateway` together.
 *
 * ⚠️ **A row whose pointer is NULL still matches.** Every payout written before
 * migration 157, and every payout raised while no gateway record claimed the
 * rail (the role fallback), carries no pointer. Refusing those would make the
 * first run after the migration create a SECOND record for every payout it had
 * already posted and relieve clearing twice - the exact defect this function
 * exists to prevent. So an unstamped row is adopted: the sync's next
 * `crud.update` writes the rail onto it. A row stamped with a DIFFERENT rail is
 * never matched. When two rows qualify, the stamped one wins over the unstamped.
 *
 * `paymentGatewayId: null` is the id-only lookup. It is what a caller with no
 * rail in hand uses (the role fallback, `reverseFailedPayout` on a webhook that
 * names only the Stripe id), and it is exactly what this function was before
 * the pair existed.
 */
export async function findPayoutByGatewayId(
  db: Database,
  organizationId: string,
  gatewayId: string,
  paymentGatewayId: string | null = null
): Promise<PayoutRecord | null> {
  const ctx = await loadPayoutFieldContext(organizationId)
  if (!ctx?.fields.payout_gateway_id) return null

  const value = alias(schema.FieldValue, 'payout_gateway_id_v')
  const rail = alias(schema.FieldValue, 'payout_payment_gateway_v')
  const railField = ctx.fields.payout_payment_gateway
  // An org short of migration 157 has no pointer field at all; its rows are
  // all unstamped, so the id-only lookup is the right answer there too.
  const byPair = paymentGatewayId !== null && railField !== null

  let query = db
    .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
    .from(schema.EntityInstance)
    .innerJoin(
      value,
      and(
        eq(value.entityId, schema.EntityInstance.id),
        eq(value.organizationId, schema.EntityInstance.organizationId),
        eq(value.fieldId, ctx.fields.payout_gateway_id.id),
        eq(value.valueText, gatewayId)
      )
    )
    .$dynamic()

  const where: SQL[] = [
    eq(schema.EntityInstance.organizationId, organizationId),
    eq(schema.EntityInstance.entityDefinitionId, ctx.payoutDefId),
    isNull(schema.EntityInstance.archivedAt),
  ]

  if (byPair) {
    // LEFT join: a row with no pointer at all must still come back.
    query = query.leftJoin(
      rail,
      and(
        eq(rail.entityId, schema.EntityInstance.id),
        eq(rail.organizationId, schema.EntityInstance.organizationId),
        eq(rail.fieldId, railField.id)
      )
    )
    const pointerMatches = or(
      isNull(rail.relatedEntityId),
      eq(rail.relatedEntityId, paymentGatewayId)
    )
    if (pointerMatches) where.push(pointerMatches)
    // `false` sorts before `true`, so a row stamped with THIS rail comes
    // before an unstamped one.
    query = query.orderBy(sql`${rail.relatedEntityId} IS NULL`)
  }

  const [row] = await query.where(and(...where)).limit(1)

  if (!row) return null
  const [record] = await hydrate(db, organizationId, ctx, [row])
  return record ?? null
}

/** The `bank_account` attributes {@link readBankAccountSettlementDestinations} reads. */
const PAYOUT_BANK_ACCOUNT_ATTRIBUTES = [
  'bank_account_gl_account',
  'bank_account_settlement_destinations',
] as const

type PayoutBankAccountAttribute = (typeof PAYOUT_BANK_ACCOUNT_ATTRIBUTES)[number]
type PayoutBankAccountFields = Record<PayoutBankAccountAttribute, { id: string } | null>

/**
 * Every confirmed settlement destination on the `bank_account` record(s) mapped to `glAccountId`
 * (58 §5.4 rule 2). Read through the entity layer directly rather than by importing `banking/` -
 * the same anti-cycle posture the deleted `findBankAccountByStripeExternalAccountId` kept: a
 * `bank_account` is an `EntityInstance` like any other, and `banking/` may in principle reach
 * back into `money/`.
 *
 * `glAccountId` is the authority (the mapped `bank` role, D7) - this is a CHECK against it, never
 * a second resolution. Empty when nothing maps to that account, which reads as a mismatch on
 * every reported destination, same as an unconfirmed one.
 */
export async function readBankAccountSettlementDestinations(
  db: Database,
  organizationId: string,
  glAccountId: string
): Promise<string[]> {
  const bankAccountDefId = await getCachedEntityDefId(organizationId, 'bank_account')
  if (!bankAccountDefId) return []

  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...PAYOUT_BANK_ACCOUNT_ATTRIBUTES])) as PayoutBankAccountFields
  const glField = fields.bank_account_gl_account
  const destinationsField = fields.bank_account_settlement_destinations
  if (!glField || !destinationsField) return []

  const matches = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, glField.id),
        eq(schema.FieldValue.valueText, glAccountId),
        eq(schema.EntityInstance.entityDefinitionId, bankAccountDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  if (matches.length === 0) return []

  const tags = await db
    .select({ optionId: schema.FieldValue.optionId, valueText: schema.FieldValue.valueText })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(
          schema.FieldValue.entityId,
          matches.map((match) => match.entityId)
        ),
        eq(schema.FieldValue.fieldId, destinationsField.id)
      )
    )
  return [
    ...new Set(tags.map((tag) => tag.optionId ?? tag.valueText).filter((v): v is string => !!v)),
  ]
}

/**
 * Every open destination mismatch on one rail's payouts (58 §5.4 rule 2), for the gateway
 * editor's readiness read (`payment-gateways/feeds.ts`).
 *
 * Narrowed in SQL on the rail pointer and a non-null mismatch, never read-then-filtered - the
 * same argument `listPayouts`'s `onlyUnidentified` makes.
 */
export interface PayoutDestinationMismatch {
  payoutId: string
  number: string | null
  message: string
}

export async function listOpenDestinationMismatches(
  db: Database,
  organizationId: string,
  paymentGatewayId: string
): Promise<PayoutDestinationMismatch[]> {
  const ctx = await loadPayoutFieldContext(organizationId)
  const mismatchField = ctx?.fields.payout_destination_mismatch
  const railField = ctx?.fields.payout_payment_gateway
  if (!ctx || !mismatchField || !railField) return []

  const mismatch = alias(schema.FieldValue, 'payout_destination_mismatch_v')
  const rail = alias(schema.FieldValue, 'payout_payment_gateway_v')
  const number = alias(schema.FieldValue, 'payout_number_v')
  const numberField = ctx.fields.payout_number

  let query = db
    .select({
      id: schema.EntityInstance.id,
      message: mismatch.valueText,
      number: numberField ? number.valueText : sql<string | null>`null`,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      mismatch,
      and(
        eq(mismatch.entityId, schema.EntityInstance.id),
        eq(mismatch.organizationId, schema.EntityInstance.organizationId),
        eq(mismatch.fieldId, mismatchField.id),
        isNotNull(mismatch.valueText)
      )
    )
    .innerJoin(
      rail,
      and(
        eq(rail.entityId, schema.EntityInstance.id),
        eq(rail.organizationId, schema.EntityInstance.organizationId),
        eq(rail.fieldId, railField.id),
        eq(rail.relatedEntityId, paymentGatewayId)
      )
    )
    .$dynamic()

  if (numberField) {
    query = query.leftJoin(
      number,
      and(
        eq(number.entityId, schema.EntityInstance.id),
        eq(number.organizationId, schema.EntityInstance.organizationId),
        eq(number.fieldId, numberField.id)
      )
    )
  }

  const rows = await query.where(
    and(
      eq(schema.EntityInstance.organizationId, organizationId),
      eq(schema.EntityInstance.entityDefinitionId, ctx.payoutDefId),
      isNull(schema.EntityInstance.archivedAt)
    )
  )

  return rows.flatMap((row) =>
    row.message ? [{ payoutId: row.id, number: row.number, message: row.message }] : []
  )
}

/** One page of payouts, newest first. */
export async function listPayouts(
  db: Database,
  params: { organizationId: string } & ListPayoutsFilters
): Promise<Result<PayoutRecord[], Error>> {
  const { organizationId, status, onlyUnidentified, limit, offset } = params
  return guard(
    async () => {
      const ctx = await loadPayoutFieldContext(organizationId)
      if (!ctx) return []

      const where: SQL[] = [
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.payoutDefId),
        isNull(schema.EntityInstance.archivedAt),
      ]

      let query = db
        .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
        .from(schema.EntityInstance)
        .$dynamic()

      if (status && ctx.fields.payout_status) {
        const statusValue = alias(schema.FieldValue, 'payout_status_v')
        query = query.innerJoin(
          statusValue,
          and(
            eq(statusValue.entityId, schema.EntityInstance.id),
            eq(statusValue.organizationId, schema.EntityInstance.organizationId),
            eq(statusValue.fieldId, ctx.fields.payout_status.id),
            eq(statusValue.optionId, status)
          )
        )
      }

      // 🛑 Narrowed in SQL, not in memory. "Which payouts left something in
      // 2450" is the queue somebody works, and filtering a page after it was cut
      // would hand back a short page whose length says nothing.
      if (onlyUnidentified && ctx.fields.payout_unrecognised_net) {
        const unidentified = alias(schema.FieldValue, 'payout_unrecognised_v')
        query = query.innerJoin(
          unidentified,
          and(
            eq(unidentified.entityId, schema.EntityInstance.id),
            eq(unidentified.organizationId, schema.EntityInstance.organizationId),
            eq(unidentified.fieldId, ctx.fields.payout_unrecognised_net.id),
            // `> 0` and not `!= 0`: the builder refuses a negative remainder
            // outright, so a stored value is never below zero.
            gt(unidentified.valueNumber, 0)
          )
        )
      }

      const rows = await query
        .where(and(...where))
        .orderBy(desc(schema.EntityInstance.createdAt))
        .limit(limit ?? DEFAULT_LIMIT)
        .offset(offset ?? 0)

      if (rows.length === 0) return []
      const records = await hydrate(db, organizationId, ctx, rows)
      const summaries = await loadPayoutSourceSummaries(db, organizationId, records)
      return records.map((record) => ({
        ...record,
        sourceSummary: summaries.get(record.payoutId) ?? null,
      }))
    },
    'Failed to list payouts',
    { organizationId }
  )
}

/** Assemble {@link PayoutRecord}s from one page of instances. */
async function hydrate(
  db: Database,
  organizationId: string,
  ctx: PayoutFieldContext,
  page: { id: string; createdAt: Date }[]
): Promise<PayoutRecord[]> {
  const ids = page.map((row) => row.id)
  const fieldIds = Object.values(ctx.fields)
    .filter((field): field is { id: string } => field != null)
    .map((field) => field.id)

  const values = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      valueDate: schema.FieldValue.valueDate,
      optionId: schema.FieldValue.optionId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, ids),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )

  const byInstance = new Map<string, Map<string, (typeof values)[number]>>()
  for (const value of values) {
    let bucket = byInstance.get(value.entityId)
    if (!bucket) {
      bucket = new Map()
      byInstance.set(value.entityId, bucket)
    }
    bucket.set(value.fieldId, value)
  }

  return page.map((row) => {
    const read = (attr: PayoutAttribute) => {
      const id = ctx.fields[attr]?.id
      return id ? (byInstance.get(row.id)?.get(id) ?? null) : null
    }
    const money = (attr: PayoutAttribute) => Number(read(attr)?.valueNumber ?? 0)
    return {
      reportedFields: Object.fromEntries(
        PAYOUT_SOURCE_ATTRIBUTES.map((attr) => [
          attr,
          read(attr)?.valueText ?? read(attr)?.valueNumber ?? null,
        ])
      ),
      payoutId: row.id,
      recordId: toRecordId(ctx.payoutDefId, row.id),
      number: read('payout_number')?.valueText ?? null,
      gatewayId: read('payout_gateway_id')?.valueText ?? null,
      status: resolvePayoutStatus(read('payout_status')?.optionId),
      paidAt: toIsoDay(read('payout_paid_at')?.valueDate),
      currency: read('payout_currency')?.valueText ?? null,
      depositedMinor: money('payout_deposited'),
      grossMinor: money('payout_gross'),
      feesMinor: money('payout_fees'),
      netMinor: money('payout_net'),
      unrecognisedNetMinor: money('payout_unrecognised_net'),
      unrecognisedCount: money('payout_unrecognised_count'),
      glPostingId: read('payout_gl_posting_id')?.valueText ?? null,
      blockedReason: read('payout_blocked_reason')?.valueText ?? null,
      bankTransactionId: read('payout_bank_transaction_id')?.valueText ?? null,
      paymentGatewayId: read('payout_payment_gateway')?.relatedEntityId ?? null,
      bankAccountId: read('payout_bank_account')?.relatedEntityId ?? null,
      destinationMismatch: read('payout_destination_mismatch')?.valueText ?? null,
      source: resolvePayoutSource(read('payout_source')?.optionId),
      createdAt: row.createdAt,
    }
  })
}

function toIsoDay(value: string | Date | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

/**
 * Narrow a stored option to a {@link PayoutSourceValue}.
 *
 * Unset reads as `synced`: a row written before migration 157 carries no
 * option, and the Stripe sync was the only writer there has ever been. The
 * migration stamps the same answer onto the row so the read is not the only
 * thing holding it.
 */
function resolvePayoutSource(value: string | null | undefined): PayoutSourceValue {
  return value === 'imported' ? 'imported' : 'synced'
}
