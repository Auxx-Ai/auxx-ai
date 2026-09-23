// packages/lib/src/accounting/provider-matches/reads.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { listOpenBillsForVendor } from '../purchasing/vendor-credit/reads'
import { MATCHABLE_PROVIDER_TXN_TYPES } from './client'

/** One provider-authored entry due an assessment, with its lines. */
export interface EntryToAssess {
  id: string
  providerTxnType: string
  providerTxnId: string
  txnDate: string
  docNumber: string | null
  lines: Array<{ providerAccountId: string; direction: 'debit' | 'credit'; amountMinor: number }>
}

/** Never assessed, or waiting on a payout of ours to arrive. */
export async function listEntriesToAssess(
  db: Database,
  organizationId: string,
  input: { bookId: string; from: string; to: string; limit?: number }
): Promise<EntryToAssess[]> {
  const e = schema.ProviderLedgerEntry
  const entries = await db
    .select({
      id: e.id,
      providerTxnType: e.providerTxnType,
      providerTxnId: e.providerTxnId,
      txnDate: e.txnDate,
      docNumber: e.docNumber,
    })
    .from(e)
    .where(
      and(
        eq(e.organizationId, organizationId),
        eq(e.bookId, input.bookId),
        eq(e.author, 'provider'),
        isNull(e.withdrawnAt),
        inArray(e.providerTxnType, [...MATCHABLE_PROVIDER_TXN_TYPES]),
        gte(e.txnDate, input.from),
        lte(e.txnDate, input.to),
        or(isNull(e.matchReason), eq(e.matchState, 'pending'))
      )
    )
    .limit(input.limit ?? 200)
  if (entries.length === 0) return []

  const lines = await db
    .select({
      entryId: schema.ProviderLedgerLine.entryId,
      providerAccountId: schema.ProviderLedgerLine.providerAccountId,
      direction: schema.ProviderLedgerLine.direction,
      amountMinor: schema.ProviderLedgerLine.amountMinor,
    })
    .from(schema.ProviderLedgerLine)
    .where(
      inArray(
        schema.ProviderLedgerLine.entryId,
        entries.map((entry) => entry.id)
      )
    )
  return entries.map((entry) => ({
    ...entry,
    lines: lines
      .filter((line) => line.entryId === entry.id)
      .map(({ providerAccountId, direction, amountMinor }) => ({
        providerAccountId,
        direction,
        amountMinor: Number(amountMinor),
      })),
  }))
}

/** The record whose posting we sent as this provider object, through its live `sent` batch. */
export async function findOurSentDocument(
  db: Database,
  organizationId: string,
  input: { objectType: string; providerObjectId: string }
): Promise<{ sourceKind: string; sourceId: string } | null> {
  const [row] = await db
    .select({
      sourceKind: schema.GlPostingSource.sourceKind,
      sourceId: schema.GlPostingSource.sourceId,
    })
    .from(schema.ExportBatch)
    .innerJoin(
      schema.ExportBatchPosting,
      and(
        eq(schema.ExportBatchPosting.organizationId, organizationId),
        eq(schema.ExportBatchPosting.batchId, schema.ExportBatch.id),
        isNull(schema.ExportBatchPosting.withdrawnAt)
      )
    )
    .innerJoin(
      schema.GlPostingSource,
      and(
        eq(schema.GlPostingSource.organizationId, organizationId),
        eq(schema.GlPostingSource.glPostingId, schema.ExportBatchPosting.glPostingId),
        eq(schema.GlPostingSource.linkRole, 'subject')
      )
    )
    .where(
      and(
        eq(schema.ExportBatch.organizationId, organizationId),
        eq(schema.ExportBatch.objectType, input.objectType),
        eq(schema.ExportBatch.providerObjectId, input.providerObjectId),
        eq(schema.ExportBatch.state, 'sent')
      )
    )
    .limit(1)
  return row ?? null
}

/** Not already the match or the suggestion of another provider entry. */
function notClaimedByAnotherEntry(idColumn: unknown) {
  return sql`NOT EXISTS (SELECT 1 FROM ${schema.ProviderLedgerEntry} other
    WHERE other."organizationId" = ${schema.MoneyTransaction.organizationId}
    AND other."matchedId" = ${idColumn}
    AND other."matchState" IN ('matched', 'suggested'))`
}

/** Receipts of ours applied to one invoice for exactly this amount, not adopted, not claimed. */
export async function listReceiptsOnInvoice(
  db: Database,
  organizationId: string,
  input: { invoiceInstanceId: string; amountMinor: number }
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: schema.MoneyTransaction.id })
    .from(schema.MoneyTransaction)
    .innerJoin(
      schema.MoneyApplication,
      and(
        eq(schema.MoneyApplication.organizationId, organizationId),
        eq(schema.MoneyApplication.moneyTransactionId, schema.MoneyTransaction.id),
        eq(schema.MoneyApplication.operation, 'apply'),
        eq(schema.MoneyApplication.invoiceInstanceId, input.invoiceInstanceId)
      )
    )
    .where(
      and(
        eq(schema.MoneyTransaction.organizationId, organizationId),
        eq(schema.MoneyTransaction.purpose, 'customer_receipt'),
        eq(schema.MoneyTransaction.amountMinor, BigInt(input.amountMinor)),
        isNull(schema.MoneyTransaction.providerLedgerEntryId),
        notClaimedByAnotherEntry(schema.MoneyTransaction.id)
      )
    )
  return rows.map((row) => row.id)
}

/** Vendor payments of ours applied to one bill for exactly this amount, not adopted, not claimed. */
export async function listVendorPaymentsOnBill(
  db: Database,
  organizationId: string,
  input: { vendorBillInstanceId: string; amountMinor: number }
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: schema.MoneyTransaction.id })
    .from(schema.MoneyTransaction)
    .innerJoin(
      schema.MoneyApplication,
      and(
        eq(schema.MoneyApplication.organizationId, organizationId),
        eq(schema.MoneyApplication.moneyTransactionId, schema.MoneyTransaction.id),
        eq(schema.MoneyApplication.operation, 'apply'),
        eq(schema.MoneyApplication.vendorBillInstanceId, input.vendorBillInstanceId)
      )
    )
    .where(
      and(
        eq(schema.MoneyTransaction.organizationId, organizationId),
        eq(schema.MoneyTransaction.purpose, 'vendor_payment'),
        eq(schema.MoneyTransaction.amountMinor, BigInt(input.amountMinor)),
        isNull(schema.MoneyTransaction.providerLedgerEntryId),
        notClaimedByAnotherEntry(schema.MoneyTransaction.id)
      )
    )
  return rows.map((row) => row.id)
}

/** Vendor payments of ours to one vendor, dated in the window, for exactly this amount. */
export async function listVendorPaymentsToVendor(
  db: Database,
  organizationId: string,
  input: { vendorInstanceId: string; amountMinor: number; from: string; to: string }
): Promise<string[]> {
  const rows = await db
    .select({ id: schema.MoneyTransaction.id })
    .from(schema.MoneyTransaction)
    .where(
      and(
        eq(schema.MoneyTransaction.organizationId, organizationId),
        eq(schema.MoneyTransaction.purpose, 'vendor_payment'),
        eq(schema.MoneyTransaction.partyInstanceId, input.vendorInstanceId),
        eq(schema.MoneyTransaction.amountMinor, BigInt(input.amountMinor)),
        gte(schema.MoneyTransaction.occurredOn, input.from),
        lte(schema.MoneyTransaction.occurredOn, input.to),
        isNull(schema.MoneyTransaction.providerLedgerEntryId),
        notClaimedByAnotherEntry(schema.MoneyTransaction.id)
      )
    )
  return rows.map((row) => row.id)
}

/** One vendor's open bills whose balance is exactly this amount, not suggested to another entry. */
export async function listOpenBillsForAmount(
  db: Database,
  organizationId: string,
  input: { vendorInstanceId: string; amountMinor: number }
): Promise<string[]> {
  const ids = (await listOpenBillsForVendor(db, organizationId, input.vendorInstanceId))
    .filter((bill) => bill.balanceMinor === input.amountMinor)
    .map((bill) => bill.vendorBillInstanceId)
  if (ids.length === 0) return []
  const claimed = await db
    .select({ matchedId: schema.ProviderLedgerEntry.matchedId })
    .from(schema.ProviderLedgerEntry)
    .where(
      and(
        eq(schema.ProviderLedgerEntry.organizationId, organizationId),
        eq(schema.ProviderLedgerEntry.matchedKind, 'vendor_bill'),
        inArray(schema.ProviderLedgerEntry.matchState, ['suggested', 'matched']),
        inArray(schema.ProviderLedgerEntry.matchedId, ids)
      )
    )
  const taken = new Set(claimed.map((row) => row.matchedId))
  return ids.filter((id) => !taken.has(id))
}

/** Whether the live posting for this subject has left in a `sent` batch. */
export async function isSubjectSent(
  db: Database,
  organizationId: string,
  input: { sourceKind: string; sourceId: string }
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.ExportBatch.id })
    .from(schema.GlPostingSource)
    .innerJoin(
      schema.GlPosting,
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        eq(schema.GlPosting.id, schema.GlPostingSource.glPostingId),
        eq(schema.GlPosting.status, 'posted')
      )
    )
    .innerJoin(
      schema.ExportBatchPosting,
      and(
        eq(schema.ExportBatchPosting.organizationId, organizationId),
        eq(schema.ExportBatchPosting.glPostingId, schema.GlPosting.id),
        isNull(schema.ExportBatchPosting.withdrawnAt)
      )
    )
    .innerJoin(
      schema.ExportBatch,
      and(
        eq(schema.ExportBatch.organizationId, organizationId),
        eq(schema.ExportBatch.id, schema.ExportBatchPosting.batchId),
        eq(schema.ExportBatch.state, 'sent')
      )
    )
    .where(
      and(
        eq(schema.GlPostingSource.organizationId, organizationId),
        eq(schema.GlPostingSource.sourceKind, input.sourceKind),
        eq(schema.GlPostingSource.sourceId, input.sourceId),
        eq(schema.GlPostingSource.linkRole, 'subject')
      )
    )
    .limit(1)
  return Boolean(row)
}

/** The rail whose `clearing` role this account is mapped to, if any. */
export async function railOfClearingAccount(
  db: Database,
  organizationId: string,
  glAccountId: string
): Promise<string | null> {
  const [row] = await db
    .select({ railId: schema.GlRoleAssignment.paymentGatewayId })
    .from(schema.GlRoleAssignment)
    .where(
      and(
        eq(schema.GlRoleAssignment.organizationId, organizationId),
        eq(schema.GlRoleAssignment.role, 'clearing'),
        eq(schema.GlRoleAssignment.glAccountId, glAccountId),
        sql`${schema.GlRoleAssignment.paymentGatewayId} IS NOT NULL`
      )
    )
    .limit(1)
  return row?.railId ?? null
}

/**
 * Payouts of ours on this rail, dated within the window, whose live entry debits exactly this
 * amount (the bank line: a feed *Add* books what landed). Returns their `payout` record ids.
 */
export async function listPayoutCandidates(
  db: Database,
  organizationId: string,
  input: { railId: string; amountMinor: number; from: string; to: string }
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ payoutId: schema.GlPostingSource.sourceId })
    .from(schema.GlPosting)
    .innerJoin(
      schema.GlPostingLine,
      and(
        eq(schema.GlPostingLine.organizationId, organizationId),
        eq(schema.GlPostingLine.glPostingId, schema.GlPosting.id),
        eq(schema.GlPostingLine.direction, 'debit'),
        eq(schema.GlPostingLine.amountMinor, input.amountMinor)
      )
    )
    .innerJoin(
      schema.GlPostingSource,
      and(
        eq(schema.GlPostingSource.organizationId, organizationId),
        eq(schema.GlPostingSource.glPostingId, schema.GlPosting.id),
        eq(schema.GlPostingSource.sourceKind, 'payout'),
        eq(schema.GlPostingSource.linkRole, 'subject')
      )
    )
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        eq(schema.GlPosting.postingType, 'payout'),
        eq(schema.GlPosting.status, 'posted'),
        eq(schema.GlPosting.railId, input.railId),
        gte(schema.GlPosting.txnDate, input.from),
        lte(schema.GlPosting.txnDate, input.to),
        sql`NOT EXISTS (SELECT 1 FROM ${schema.ProviderLedgerEntry} other
          WHERE other."organizationId" = ${organizationId}
          AND other."matchedId" = ${schema.GlPostingSource.sourceId}
          AND other."matchState" IN ('matched', 'suggested'))`
      )
    )
  return rows.map((row) => row.payoutId)
}
