// packages/lib/src/accounting/money/payouts/reads.ts

/**
 * Every READ over payouts. The def-and-field contexts live in `fields.ts`.
 *
 * Reads only. The writes live in `sync.ts`, because a file that both queries and
 * mutates is the first step back toward a service class
 * (`docs/lib-module-guide.md` §5).
 *
 * No permission checks anywhere in this file - the router asserts `ledgerView`
 * and hands the narrowed filters down (§6).
 */

import { type Database, schema } from '@auxx/database'
import { toDateKey } from '@auxx/utils/calendar-day'
import { and, desc, eq, gt, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import {
  inPageOrder,
  readSystemRecords,
  type SystemRecord,
  systemValueJoin,
} from '../../../resources/system-records'
import { resolvePayoutStatus } from './client'
import {
  loadPayoutBankAccountFieldContext,
  loadPayoutFieldContext,
  PAYOUT_SOURCE_ATTRIBUTES,
  type PayoutAttribute,
} from './fields'
import { guard } from './guard'
import { loadPayoutSourceSummaries } from './source-reads'
import type { ListPayoutsFilters, PayoutRecord, PayoutSourceValue } from './types'

const DEFAULT_LIMIT = 100

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
  const ctx = await loadPayoutFieldContext(db, organizationId)
  if (!ctx?.fields.payout_gateway_id) return null

  const value = alias(schema.FieldValue, 'payout_gateway_id_v')
  const rail = alias(schema.FieldValue, 'payout_payment_gateway_v')
  const railField = ctx.fields.payout_payment_gateway
  // An org short of migration 157 has no pointer field at all; its rows are
  // all unstamped, so the id-only lookup is the right answer there too.
  const byPair = paymentGatewayId !== null && railField !== null

  let query = db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      value,
      and(systemValueJoin(value, ctx.fields.payout_gateway_id.id), eq(value.valueText, gatewayId))
    )
    .$dynamic()

  const where: SQL[] = [
    eq(schema.EntityInstance.organizationId, organizationId),
    eq(schema.EntityInstance.entityDefinitionId, ctx.defId),
    isNull(schema.EntityInstance.archivedAt),
  ]

  if (byPair) {
    // LEFT join: a row with no pointer at all must still come back.
    query = query.leftJoin(rail, systemValueJoin(rail, railField.id))
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
  const records = await readSystemRecords(db, organizationId, ctx, { ids: [row.id] })
  const [record] = await hydrate(db, organizationId, records)
  return record ?? null
}

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
  const ctx = await loadPayoutBankAccountFieldContext(db, organizationId)
  if (!ctx?.fields.bank_account_gl_account) return []

  // Value-keyed: which records hold THIS gl account. The reader answers by id,
  // so the lookup stays a SQL filter on the value join.
  const glValue = alias(schema.FieldValue, 'bank_account_gl_account_v')
  const matches = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      glValue,
      and(
        systemValueJoin(glValue, ctx.fields.bank_account_gl_account.id),
        eq(glValue.valueText, glAccountId)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.defId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  if (matches.length === 0) return []

  const records = await readSystemRecords(db, organizationId, ctx, {
    ids: matches.map((match) => match.id),
  })
  // TAGS (58 §4.4): one row per destination, the typed text written AS the
  // `optionId`, so the open-tag fallback to `valueText` has no typed shape.
  return [
    ...new Set(
      records.flatMap((record) =>
        record
          .rows('bank_account_settlement_destinations')
          .map((value) => value.optionId ?? value.valueText)
          .filter((destination): destination is string => !!destination)
      )
    ),
  ]
}

/**
 * Every open destination mismatch on one rail's payouts (58 §5.4 rule 2), for the gateway
 * editor's readiness read (`accounting/rails/feeds.ts`).
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
  const ctx = await loadPayoutFieldContext(db, organizationId)
  const mismatchField = ctx?.fields.payout_destination_mismatch
  const railField = ctx?.fields.payout_payment_gateway
  if (!ctx || !mismatchField || !railField) return []

  const mismatch = alias(schema.FieldValue, 'payout_destination_mismatch_v')
  const rail = alias(schema.FieldValue, 'payout_payment_gateway_v')

  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      mismatch,
      and(systemValueJoin(mismatch, mismatchField.id), isNotNull(mismatch.valueText))
    )
    .innerJoin(
      rail,
      and(systemValueJoin(rail, railField.id), eq(rail.relatedEntityId, paymentGatewayId))
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.defId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  if (rows.length === 0) return []

  const records = await readSystemRecords(db, organizationId, ctx, {
    ids: rows.map((row) => row.id),
  })
  return records.flatMap((record) => {
    const message = record.text('payout_destination_mismatch')
    return message ? [{ payoutId: record.id, number: record.text('payout_number'), message }] : []
  })
}

/** One page of payouts, newest first. */
export async function listPayouts(
  db: Database,
  params: { organizationId: string } & ListPayoutsFilters
): Promise<Result<PayoutRecord[], Error>> {
  const { organizationId, status, onlyUnidentified, limit, offset } = params
  return guard(
    async () => {
      const ctx = await loadPayoutFieldContext(db, organizationId)
      if (!ctx) return []

      const where: SQL[] = [
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.defId),
        isNull(schema.EntityInstance.archivedAt),
      ]

      let query = db.select({ id: schema.EntityInstance.id }).from(schema.EntityInstance).$dynamic()

      if (status && ctx.fields.payout_status) {
        const statusValue = alias(schema.FieldValue, 'payout_status_v')
        query = query.innerJoin(
          statusValue,
          and(
            systemValueJoin(statusValue, ctx.fields.payout_status.id),
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
            systemValueJoin(unidentified, ctx.fields.payout_unrecognised_net.id),
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
      const ids = rows.map((row) => row.id)
      const page = await readSystemRecords(db, organizationId, ctx, { ids })
      const records = await hydrate(db, organizationId, inPageOrder(page, ids))
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

/** Assemble {@link PayoutRecord}s from one page of system records. */
async function hydrate(
  db: Database,
  organizationId: string,
  page: SystemRecord<PayoutAttribute>[]
): Promise<PayoutRecord[]> {
  const records: PayoutRecord[] = page.map((record) => {
    const paidAt = record.date('payout_paid_at')
    const money = (attribute: PayoutAttribute) => record.number(attribute) ?? 0
    return {
      reportedFields: Object.fromEntries(
        PAYOUT_SOURCE_ATTRIBUTES.map((attribute) => [
          attribute,
          record.text(attribute) ?? record.number(attribute),
        ])
      ),
      payoutId: record.id,
      recordId: record.recordId,
      number: record.text('payout_number'),
      gatewayId: record.text('payout_gateway_id'),
      status: resolvePayoutStatus(record.option('payout_status')),
      paidAt: paidAt ? toDateKey(paidAt) : null,
      currency: record.text('payout_currency'),
      depositedMinor: money('payout_deposited'),
      grossMinor: money('payout_gross'),
      feesMinor: money('payout_fees'),
      netMinor: money('payout_net'),
      unrecognisedNetMinor: money('payout_unrecognised_net'),
      unrecognisedCount: money('payout_unrecognised_count'),
      blockedReason: record.text('payout_blocked_reason'),
      bankTransactionId: record.text('payout_bank_transaction_id'),
      paymentGatewayId: record.related('payout_payment_gateway'),
      bankAccountId: record.related('payout_bank_account'),
      glPostingId: null,
      destinationMismatch: record.text('payout_destination_mismatch'),
      source: resolvePayoutSource(record.option('payout_source')),
      createdAt: record.createdAt ?? new Date(0),
    }
  })
  return withLivePostings(db, organizationId, records)
}

/** Stamp each record's live `posted` entry from the claim table, one query per page. */
async function withLivePostings(
  db: Database,
  organizationId: string,
  records: PayoutRecord[]
): Promise<PayoutRecord[]> {
  const gatewayIds = records.map((r) => r.gatewayId).filter((id): id is string => !!id)
  if (gatewayIds.length === 0) return records
  const rows = await db
    .select({ sourceId: schema.GlPostingSource.sourceId, glPostingId: schema.GlPosting.id })
    .from(schema.GlPostingSource)
    .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingSource.glPostingId))
    .where(
      and(
        eq(schema.GlPostingSource.organizationId, organizationId),
        eq(schema.GlPostingSource.sourceKind, 'payout'),
        eq(schema.GlPostingSource.linkRole, 'subject'),
        inArray(schema.GlPostingSource.sourceId, gatewayIds),
        eq(schema.GlPosting.status, 'posted')
      )
    )
  const byGateway = new Map(rows.map((row) => [row.sourceId, row.glPostingId]))
  return records.map((record) =>
    record.gatewayId && byGateway.has(record.gatewayId)
      ? { ...record, glPostingId: byGateway.get(record.gatewayId) ?? null }
      : record
  )
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
