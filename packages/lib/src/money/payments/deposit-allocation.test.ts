// packages/lib/src/money/payments/deposit-allocation.test.ts

import { describe, expect, it } from 'vitest'
import { planDepositApplication } from './deposit-allocation'

// Amounts are integer cents (the MQ1 storage convention) — e.g. 10_000 = $100.00.

describe('planDepositApplication', () => {
  it('partially applies a deposit that exceeds the invoice (THE overshoot bug)', () => {
    // $200 deposit, $150 invoice → $150 applied, $50 stays unallocated for invoice #2.
    const planned = planDepositApplication(
      [{ id: 'dep-1', amount: 20_000, allocatedTotal: 0 }],
      15_000,
      0
    )
    expect(planned).toEqual([{ transactionId: 'dep-1', amount: 15_000 }])
  })

  it('applies the remainder of a partially-allocated deposit to a second invoice', () => {
    // Same $200 deposit, $150 already allocated to invoice #1 → $50 left, applied in full to
    // a $150 invoice #2 (invoice #2's remaining balance stays $100, but that math is the
    // caller's — this only plans what the deposit itself can still give).
    const planned = planDepositApplication(
      [{ id: 'dep-1', amount: 20_000, allocatedTotal: 15_000 }],
      15_000,
      0
    )
    expect(planned).toEqual([{ transactionId: 'dep-1', amount: 5_000 }])
  })

  it('applies a deposit in full when it is less than or equal to the invoice', () => {
    const planned = planDepositApplication(
      [{ id: 'dep-1', amount: 10_000, allocatedTotal: 0 }],
      15_000,
      0
    )
    expect(planned).toEqual([{ transactionId: 'dep-1', amount: 10_000 }])
  })

  it('applies a deposit exactly equal to the invoice, fully draining both', () => {
    const planned = planDepositApplication(
      [{ id: 'dep-1', amount: 15_000, allocatedTotal: 0 }],
      15_000,
      0
    )
    expect(planned).toEqual([{ transactionId: 'dep-1', amount: 15_000 }])
  })

  it('drains multiple deposits in order until the invoice remaining hits 0', () => {
    // Two $100 deposits (paid in order dep-1 then dep-2) against a $150 invoice: dep-1 gives
    // its full $100, dep-2 gives only the remaining $50 and keeps $50 unallocated.
    const planned = planDepositApplication(
      [
        { id: 'dep-1', amount: 10_000, allocatedTotal: 0 },
        { id: 'dep-2', amount: 10_000, allocatedTotal: 0 },
      ],
      15_000,
      0
    )
    expect(planned).toEqual([
      { transactionId: 'dep-1', amount: 10_000 },
      { transactionId: 'dep-2', amount: 5_000 },
    ])
  })

  it('is a no-op when the invoice has no remaining balance', () => {
    // existingAllocationsTotal already covers the invoice total.
    const planned = planDepositApplication(
      [{ id: 'dep-1', amount: 20_000, allocatedTotal: 0 }],
      15_000,
      15_000
    )
    expect(planned).toEqual([])
  })

  it('is a no-op when invoiceTotal is 0 (a freshly-created, line-less invoice)', () => {
    const planned = planDepositApplication(
      [{ id: 'dep-1', amount: 20_000, allocatedTotal: 0 }],
      0,
      0
    )
    expect(planned).toEqual([])
  })

  it('skips a fully-allocated deposit and offers the next one instead', () => {
    const planned = planDepositApplication(
      [
        { id: 'dep-1', amount: 10_000, allocatedTotal: 10_000 }, // nothing left
        { id: 'dep-2', amount: 10_000, allocatedTotal: 0 },
      ],
      15_000,
      0
    )
    expect(planned).toEqual([{ transactionId: 'dep-2', amount: 10_000 }])
  })

  it('accounts for existing allocations already on this invoice from another source', () => {
    // $100 already allocated to this invoice (e.g. a manual payment), $50 remaining on a $150
    // invoice — a $200 deposit only gives up $50.
    const planned = planDepositApplication(
      [{ id: 'dep-1', amount: 20_000, allocatedTotal: 0 }],
      15_000,
      10_000
    )
    expect(planned).toEqual([{ transactionId: 'dep-1', amount: 5_000 }])
  })

  it('returns an empty plan for an empty deposits list', () => {
    expect(planDepositApplication([], 15_000, 0)).toEqual([])
  })
})
