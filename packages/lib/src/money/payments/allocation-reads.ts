// packages/lib/src/money/payments/allocation-reads.ts
//
// Read-only queries over `PaymentAllocation` (deposit-accounting plan 16 §D) — deliberately
// separate from `ledger.ts` (the sanctioned WRITE path for both tables, owned by a concurrent
// agent this week). Every deposit-visibility surface (WO billing state, contact billing
// overview, the payments-list server mapper, the public pay/PDF payloads) reads allocation
// totals through here so the "held vs applied" math can't drift between call sites.

import { type Database, database, schema } from '@auxx/database'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'

/** One succeeded deposit charge row, as needed by {@link computeDepositFigures}. */
export interface DepositChargeRow {
  id: string
  amount: number
}

/**
 * Charge ids whose refund has SUCCEEDED, derived from a batch of ledger rows already in hand
 * (money 16 follow-up) — refunds are full-only, and a refunded charge row deliberately keeps
 * `status: 'succeeded'` (reversal-as-records, never edits), so held/applied/credit figures must
 * exclude it explicitly or a refunded deposit reads as "held" forever. Pending refunds do NOT
 * exclude — the money hasn't actually returned yet.
 */
export function collectRefundedChargeIds(
  rows: Array<{ kind: string; status: string; refundedTransactionId: string | null }>
): Set<string> {
  const refunded = new Set<string>()
  for (const row of rows) {
    if (row.kind === 'refund' && row.status === 'succeeded' && row.refundedTransactionId) {
      refunded.add(row.refundedTransactionId)
    }
  }
  return refunded
}

/**
 * DB variant of {@link collectRefundedChargeIds} for callers that only have charge ids in hand
 * (the contact credit-on-account read) — one batched query for succeeded refunds pointing at
 * any of the given charges.
 */
export async function getRefundedChargeIds(
  organizationId: string,
  chargeIds: string[],
  db: Database = database
): Promise<Set<string>> {
  if (chargeIds.length === 0) return new Set()
  const rows = await db.query.PaymentTransaction.findMany({
    where: and(
      eq(schema.PaymentTransaction.organizationId, organizationId),
      eq(schema.PaymentTransaction.kind, 'refund'),
      eq(schema.PaymentTransaction.status, 'succeeded'),
      inArray(schema.PaymentTransaction.refundedTransactionId, chargeIds)
    ),
    columns: { refundedTransactionId: true },
  })
  return new Set(
    rows.flatMap((row) => (row.refundedTransactionId ? [row.refundedTransactionId] : []))
  )
}

/**
 * Sum `PaymentAllocation.amount` grouped by `paymentTransactionId`, scoped to one organization
 * and a batch of transaction ids — the shared no-N+1 primitive every deposit-visibility read
 * uses (mirrors `getActiveAllocatedAmounts`'s shape in `billing-allocations.ts`). Missing ids
 * are simply absent from the map (callers treat that as `0` via `?? 0`).
 */
export async function getAllocationTotalsByTransaction(
  organizationId: string,
  transactionIds: string[],
  db: Database = database
): Promise<Map<string, number>> {
  if (transactionIds.length === 0) return new Map()
  const rows = await db
    .select({
      paymentTransactionId: schema.PaymentAllocation.paymentTransactionId,
      amount: schema.PaymentAllocation.amount,
    })
    .from(schema.PaymentAllocation)
    .where(
      and(
        eq(schema.PaymentAllocation.organizationId, organizationId),
        inArray(schema.PaymentAllocation.paymentTransactionId, transactionIds)
      )
    )
  const totals = new Map<string, number>()
  for (const row of rows) {
    totals.set(row.paymentTransactionId, (totals.get(row.paymentTransactionId) ?? 0) + row.amount)
  }
  return totals
}

/**
 * Pure fold over a set of succeeded deposit-charge rows + their allocation totals (money 16
 * §D.1/§D.4) — `depositHeld` = Σ unallocated remainder (never negative — an over-applied row
 * can't happen, allocations are capped at insert time, but the clamp is cheap insurance),
 * `depositApplied` = Σ allocated (also capped at the row's own amount). No DB access, so the
 * WO billing state (rows already in hand from `listWorkOrderPayments`) and the contact overview
 * (a fresh query, see {@link listContactDepositCharges}) share the exact same math. Charges in
 * `refundedChargeIds` contribute to NEITHER figure — the money went back to the customer
 * (see {@link collectRefundedChargeIds}); their invoice-side netting is the refund row's own
 * allocation copies, not this fold's concern.
 */
export function computeDepositFigures(
  rows: DepositChargeRow[],
  allocationTotals: Map<string, number>,
  refundedChargeIds: ReadonlySet<string> = new Set()
): { depositHeld: number; depositApplied: number } {
  let depositHeld = 0
  let depositApplied = 0
  for (const row of rows) {
    if (refundedChargeIds.has(row.id)) continue
    const allocated = allocationTotals.get(row.id) ?? 0
    depositHeld += Math.max(0, row.amount - allocated)
    depositApplied += Math.min(row.amount, allocated)
  }
  return { depositHeld, depositApplied }
}

/**
 * A contact's succeeded, quote-provenance deposit charges (money 16 §D.4) — the credit-on-
 * account read's own query, since `getContactBillingOverview` doesn't otherwise touch
 * `PaymentTransaction`. Old pre-plan-16 rows have `contactInstanceId: null` and are correctly
 * excluded (§Decisions — "they just don't count").
 */
export async function listContactDepositCharges(
  organizationId: string,
  contactInstanceId: string,
  db: Database = database
): Promise<DepositChargeRow[]> {
  return db.query.PaymentTransaction.findMany({
    where: and(
      eq(schema.PaymentTransaction.organizationId, organizationId),
      eq(schema.PaymentTransaction.contactInstanceId, contactInstanceId),
      eq(schema.PaymentTransaction.kind, 'charge'),
      eq(schema.PaymentTransaction.status, 'succeeded'),
      isNotNull(schema.PaymentTransaction.quoteInstanceId)
    ),
    columns: { id: true, amount: true },
  })
}

/**
 * Σ unallocated remainders of a contact's succeeded deposit charges — "credit on account"
 * (money 16 §D.4). Three batched queries (charges, their allocation totals, their succeeded
 * refunds), never N+1. Refunded deposits are excluded — returned money is not credit.
 */
export async function getContactCreditOnAccount(
  organizationId: string,
  contactInstanceId: string,
  db: Database = database
): Promise<number> {
  const rows = await listContactDepositCharges(organizationId, contactInstanceId, db)
  const chargeIds = rows.map((row) => row.id)
  const [allocationTotals, refundedChargeIds] = await Promise.all([
    getAllocationTotalsByTransaction(organizationId, chargeIds, db),
    getRefundedChargeIds(organizationId, chargeIds, db),
  ])
  return computeDepositFigures(rows, allocationTotals, refundedChargeIds).depositHeld
}

/**
 * Σ allocation amounts posted against one invoice from succeeded (or `disputed` — still
 * money-in-flight, same posture as `computeAmountPaid` in `ledger.ts`) DEPOSIT charges
 * (`quoteInstanceId IS NOT NULL`), signed by the owning transaction's `kind` (money 16 §E) — a
 * refund copy (§C.5) nets its charge's contribution back to zero. Backs the "Deposit applied"
 * line on the public pay page and the invoice PDF; ordinary (non-deposit) invoice-checkout
 * allocations are deliberately excluded — this is a labeling figure, not `amountPaid`.
 */
export async function getInvoiceDepositApplied(
  organizationId: string,
  invoiceInstanceId: string,
  db: Database = database
): Promise<number> {
  const rows = await db
    .select({
      amount: schema.PaymentAllocation.amount,
      kind: schema.PaymentTransaction.kind,
    })
    .from(schema.PaymentAllocation)
    .innerJoin(
      schema.PaymentTransaction,
      eq(schema.PaymentAllocation.paymentTransactionId, schema.PaymentTransaction.id)
    )
    .where(
      and(
        eq(schema.PaymentAllocation.organizationId, organizationId),
        eq(schema.PaymentAllocation.invoiceInstanceId, invoiceInstanceId),
        isNotNull(schema.PaymentTransaction.quoteInstanceId),
        inArray(schema.PaymentTransaction.status, ['succeeded', 'disputed'])
      )
    )
  return rows.reduce((sum, row) => sum + (row.kind === 'refund' ? -row.amount : row.amount), 0)
}
