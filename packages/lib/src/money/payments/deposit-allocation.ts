// packages/lib/src/money/payments/deposit-allocation.ts
// Deposit application math for money 16-deposit-accounting.md §C.2. Pure function — no Stripe
// import, no DB access — same shape as `resolveApplicationFee` (fees.ts) and
// `computeDepositAmount` (deposit.ts), unit-tested the same way (deposit-allocation.test.ts,
// sibling to fees.test.ts). `applyHeldDepositsToInvoice` (ledger.ts) is the I/O wrapper that
// loads the succeeded deposit charges + their existing allocations, feeds them through this
// function, and inserts the resulting `PaymentAllocation` rows.

/** A succeeded deposit charge available to apply, with its already-allocated total so far. */
export interface DepositForAllocation {
  /** `PaymentTransaction.id` of the succeeded deposit charge. */
  id: string
  /** Integer cents — the charge's full amount. */
  amount: number
  /** Integer cents — the sum of this charge's existing `PaymentAllocation` rows (any invoice). */
  allocatedTotal: number
}

/** One planned `PaymentAllocation` insert. */
export interface PlannedAllocation {
  /** `PaymentTransaction.id` the allocation is against. */
  transactionId: string
  /** Integer cents — always > 0. */
  amount: number
}

/**
 * Plan how much of each deposit to apply to an invoice, in integer cents. Caller passes
 * `deposits` already ordered `createdAt` asc (oldest first — the order money was actually
 * collected) so ties drain in a deterministic, chronological order. Each deposit is capped at
 * `min(unallocated, invoiceRemaining)`; the loop stops once `invoiceRemaining` hits 0 or the
 * deposits run out. Partial application falls out for free: a $200 deposit against a $150
 * invoice allocates $150 here and leaves $50 `unallocated` for the deposit's next invoice.
 *
 * Pure — takes `invoiceTotal`/`existingAllocationsTotal` instead of re-deriving them, so it
 * never needs to know how "existing allocations" or "unallocated" are computed (signed sums,
 * refunds, etc. — that's the caller's job, `applyHeldDepositsToInvoice`).
 */
export function planDepositApplication(
  deposits: DepositForAllocation[],
  invoiceTotal: number,
  existingAllocationsTotal: number
): PlannedAllocation[] {
  let invoiceRemaining = invoiceTotal - existingAllocationsTotal
  const planned: PlannedAllocation[] = []
  if (invoiceRemaining <= 0) return planned

  for (const deposit of deposits) {
    if (invoiceRemaining <= 0) break
    const unallocated = deposit.amount - deposit.allocatedTotal
    if (unallocated <= 0) continue
    const amount = Math.min(unallocated, invoiceRemaining)
    if (amount <= 0) continue
    planned.push({ transactionId: deposit.id, amount })
    invoiceRemaining -= amount
  }

  return planned
}
