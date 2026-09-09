// packages/lib/src/money/credit-memos/apply.test.ts
//
// The two pure pieces of the credit memo module, tested the way
// `deposit-allocation.test.ts` tests `planDepositApplication`:
//
//  1. `planCreditApplication`: oldest memo first, capped at min(memo balance,
//     invoice remaining), stops when the invoice is covered.
//  2. `shareInvoiceTaxAcrossLines`: the per-line tax share a memo transcribes
//     from an invoice, verbatim when the line carries one and prorated from the
//     header otherwise, summing to the header exactly.
//
// Amounts are integer minor units: 12_000 = $120.00.

import { describe, expect, it } from 'vitest'
import { planCreditApplication } from './client'
import type { InvoiceLineForCredit } from './reads'
import { shareInvoiceTaxAcrossLines } from './writes'

describe('planCreditApplication', () => {
  it('caps a memo larger than the invoice at the invoice balance (the overshoot case)', () => {
    expect(planCreditApplication([{ id: 'cm-1', balanceMinor: 20_000 }], 15_000)).toEqual([
      { creditMemoInstanceId: 'cm-1', amountMinor: 15_000 },
    ])
  })

  it('applies a memo in full when it is smaller than the invoice', () => {
    expect(planCreditApplication([{ id: 'cm-1', balanceMinor: 10_000 }], 15_000)).toEqual([
      { creditMemoInstanceId: 'cm-1', amountMinor: 10_000 },
    ])
  })

  it('drains memos in the order given until the invoice is covered', () => {
    expect(
      planCreditApplication(
        [
          { id: 'cm-1', balanceMinor: 10_000 },
          { id: 'cm-2', balanceMinor: 10_000 },
          { id: 'cm-3', balanceMinor: 10_000 },
        ],
        15_000
      )
    ).toEqual([
      { creditMemoInstanceId: 'cm-1', amountMinor: 10_000 },
      { creditMemoInstanceId: 'cm-2', amountMinor: 5_000 },
    ])
  })

  it('skips a memo with no balance rather than refusing', () => {
    expect(
      planCreditApplication(
        [
          { id: 'settled', balanceMinor: 0 },
          { id: 'cm-2', balanceMinor: 4_000 },
        ],
        15_000
      )
    ).toEqual([{ creditMemoInstanceId: 'cm-2', amountMinor: 4_000 }])
  })

  it('plans nothing for an invoice with no balance', () => {
    expect(planCreditApplication([{ id: 'cm-1', balanceMinor: 10_000 }], 0)).toEqual([])
    expect(planCreditApplication([{ id: 'cm-1', balanceMinor: 10_000 }], -500)).toEqual([])
  })

  it('plans nothing with no memos', () => {
    expect(planCreditApplication([], 15_000)).toEqual([])
  })

  it('never plans a fractional cent', () => {
    expect(planCreditApplication([{ id: 'cm-1', balanceMinor: 100.9 }], 50.5)).toEqual([
      { creditMemoInstanceId: 'cm-1', amountMinor: 50 },
    ])
  })
})

function line(overrides: Partial<InvoiceLineForCredit> & { id: string }): InvoiceLineForCredit {
  return {
    name: 'Line',
    qty: 1,
    unitPriceMinor: 10_000,
    lineTotalMinor: 10_000,
    taxable: true,
    taxTotalMinor: null,
    sortOrder: 0,
    ...overrides,
  }
}

describe('shareInvoiceTaxAcrossLines', () => {
  it('takes a per-line tax verbatim when the line carries one', () => {
    const shares = shareInvoiceTaxAcrossLines(
      [line({ id: 'a', taxTotalMinor: 725 }), line({ id: 'b', taxTotalMinor: 0 })],
      725
    )
    expect(shares.get('a')).toBe(725)
    expect(shares.get('b')).toBe(0)
  })

  it('prorates the header tax across taxable lines by line total, summing exactly', () => {
    // 10.00 + 20.00 + 30.00 taxable, 8.25% tax on 60.00 = 4.95 (495). The exact
    // shares are 82.5 / 165 / 247.5; floor gives 82 / 165 / 247 = 494, and the
    // one remaining cent goes to the largest fractional share.
    const shares = shareInvoiceTaxAcrossLines(
      [
        line({ id: 'a', lineTotalMinor: 1_000 }),
        line({ id: 'b', lineTotalMinor: 2_000 }),
        line({ id: 'c', lineTotalMinor: 3_000 }),
      ],
      495
    )
    const total = [...shares.values()].reduce((sum, share) => sum + share, 0)
    expect(total).toBe(495)
    expect(shares.get('b')).toBe(165)
    expect((shares.get('a') ?? 0) + (shares.get('c') ?? 0)).toBe(330)
  })

  it('gives a non-taxable line no share and leaves the rest to the taxable ones', () => {
    const shares = shareInvoiceTaxAcrossLines(
      [line({ id: 'taxed', lineTotalMinor: 5_000 }), line({ id: 'exempt', taxable: false })],
      400
    )
    expect(shares.get('taxed')).toBe(400)
    expect(shares.has('exempt')).toBe(false)
  })

  it('shares nothing when the invoice carries no tax', () => {
    const shares = shareInvoiceTaxAcrossLines([line({ id: 'a' }), line({ id: 'b' })], 0)
    expect(shares.get('a')).toBe(0)
    expect(shares.get('b')).toBe(0)
  })

  it('mixes verbatim and prorated lines without double counting', () => {
    // `a` carries its own 100; the header's 300 is prorated over `b` and `c`
    // only, because a line with a stated tax is not in the proration base.
    const shares = shareInvoiceTaxAcrossLines(
      [
        line({ id: 'a', taxTotalMinor: 100 }),
        line({ id: 'b', lineTotalMinor: 1_000 }),
        line({ id: 'c', lineTotalMinor: 1_000 }),
      ],
      300
    )
    expect(shares.get('a')).toBe(100)
    expect(shares.get('b')).toBe(150)
    expect(shares.get('c')).toBe(150)
  })
})
