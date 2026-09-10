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
import { and, desc, eq, gt, inArray, isNull, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { UnprocessableEntityError } from '../../errors'
import { toRecordId } from '../../resources/resource-id'
import { resolvePayoutStatus } from './client'
import { guard } from './guard'
import type { ListPayoutsFilters, PayoutRecord } from './types'

/** Every `payout` attribute a {@link PayoutRecord} is assembled from. */
const PAYOUT_ATTRIBUTES = [
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

/**
 * The payout row for one gateway id, or `null`.
 *
 * 🛑 THE idempotency check for the sync, which is a poll and sees every payout
 * again on every run. It reads `payout_gateway_id` rather than trusting a
 * watermark alone: a watermark can be re-run, reset, or overlap a boundary, and
 * a second posting of the same payout would relieve clearing twice.
 */
export async function findPayoutByGatewayId(
  db: Database,
  organizationId: string,
  gatewayId: string
): Promise<PayoutRecord | null> {
  const ctx = await loadPayoutFieldContext(organizationId)
  if (!ctx?.fields.payout_gateway_id) return null

  const value = alias(schema.FieldValue, 'payout_gateway_id_v')
  const [row] = await db
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
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.payoutDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)

  if (!row) return null
  const [record] = await hydrate(db, organizationId, ctx, [row])
  return record ?? null
}

/**
 * The `bank_account` attributes {@link findBankAccountByStripeExternalAccountId}
 * reads. Read through the entity layer directly rather than by importing
 * `banking/` - the same anti-cycle reason `money/bank-deposits/reads.ts` gives
 * for its own `readDepositBankAccount`: a `bank_account` is an `EntityInstance`
 * like any other, and `banking/` may in principle reach back into `money/`.
 */
const PAYOUT_BANK_ACCOUNT_ATTRIBUTES = [
  'bank_account_stripe_external_account_id',
  'bank_account_gl_account',
] as const

type PayoutBankAccountAttribute = (typeof PAYOUT_BANK_ACCOUNT_ATTRIBUTES)[number]
type PayoutBankAccountFields = Record<PayoutBankAccountAttribute, { id: string } | null>

/** What a payout's Stripe destination resolves to. */
export interface PayoutBankAccountMatch {
  bankAccountId: string
  /** Null when the matched account carries no chart mapping. */
  glAccountId: string | null
}

/**
 * Resolve a Stripe payout's `destination` to the org's own `bank_account`,
 * through its CONFIRMED `stripeExternalAccountId` identity (brief 13 §2.3).
 *
 * 🛑 Never matched on `last4` - a four-digit string is strong evidence and not
 * proof, and two accounts at one bank can share one (the same argument
 * `resolveMappedAccounts:291-298` makes about QuickBooks' `AcctNum`).
 *
 * `null` when no LIVE (non-archived) bank account in this org carries that
 * identity - the caller refuses to post rather than guessing which account.
 */
export async function findBankAccountByStripeExternalAccountId(
  db: Database,
  organizationId: string,
  destination: string
): Promise<PayoutBankAccountMatch | null> {
  const bankAccountDefId = await getCachedEntityDefId(organizationId, 'bank_account')
  if (!bankAccountDefId) return null

  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...PAYOUT_BANK_ACCOUNT_ATTRIBUTES])) as PayoutBankAccountFields
  const stripeField = fields.bank_account_stripe_external_account_id
  if (!stripeField) return null

  const [match] = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, stripeField.id),
        eq(schema.FieldValue.valueText, destination),
        eq(schema.EntityInstance.entityDefinitionId, bankAccountDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)
  if (!match) return null

  const glField = fields.bank_account_gl_account
  let glAccountId: string | null = null
  if (glField) {
    const [value] = await db
      .select({ valueText: schema.FieldValue.valueText })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.entityId, match.entityId),
          eq(schema.FieldValue.fieldId, glField.id)
        )
      )
      .limit(1)
    glAccountId = value?.valueText?.trim() || null
  }

  return { bankAccountId: match.entityId, glAccountId }
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
      return hydrate(db, organizationId, ctx, rows)
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
      createdAt: row.createdAt,
    }
  })
}

function toIsoDay(value: string | Date | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}
