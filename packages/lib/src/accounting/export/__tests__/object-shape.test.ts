// packages/lib/src/accounting/export/__tests__/object-shape.test.ts
// One case per native object type (plan 67 §1's mapping table), the `auto` vs
// `invoice` split, the sales-tax line's `taxCode: 'NON'`, and the journal
// fallback when a posting's lines do not fit its object's shape.

import { describe, expect, it } from 'vitest'
import type { AccountRole } from '../../ledger/builders/entry'
import {
  type ShapeForPostingInput,
  type ShapeForPostingLine,
  shapeForPosting,
} from '../object-shape'

const CUSTOMER = { type: 'customer' as const, id: 'contact_1' }
const VENDOR = { type: 'vendor' as const, id: 'company_1' }

function line(
  glAccountId: string,
  role: AccountRole | null,
  direction: 'debit' | 'credit',
  amountMinor: number,
  extra: Partial<ShapeForPostingLine> = {}
): { line: ShapeForPostingLine; role: AccountRole | null } {
  return {
    line: {
      glAccountId,
      accountCode: glAccountId.toUpperCase(),
      direction,
      amountMinor,
      sortOrder: 0,
      ...extra,
    },
    role,
  }
}

/** Assembles `lines` and `roleByGlAccountId` from `line()` results in one call. */
function withLines(...entries: Array<{ line: ShapeForPostingLine; role: AccountRole | null }>) {
  const roleByGlAccountId = new Map<string, AccountRole | null>()
  for (const entry of entries) roleByGlAccountId.set(entry.line.glAccountId, entry.role)
  return { lines: entries.map((entry) => entry.line), roleByGlAccountId }
}

function posting(
  over: Partial<ShapeForPostingInput['posting']> = {}
): ShapeForPostingInput['posting'] {
  return {
    id: 'glp_1',
    postingType: 'fulfillment',
    txnDate: '2026-09-14',
    docNumber: 'AUXX-FUL-20260914',
    totalMinor: 5000,
    currency: 'USD',
    storeId: 'store_1',
    railId: null,
    ...over,
  }
}

describe('shapeForPosting', () => {
  it('a fulfillment fully paid under `auto` becomes a sales_receipt', () => {
    const { lines, roleByGlAccountId } = withLines(
      line('acct_ar', 'accounts_receivable', 'debit', 5000, { counterparty: CUSTOMER }),
      line('acct_rev', 'revenue_product', 'credit', 4800),
      line('acct_tax', 'sales_tax_payable', 'credit', 200),
      line('acct_clearing', 'clearing', 'debit', 5000),
      line('acct_ar', 'accounts_receivable', 'credit', 5000, { counterparty: CUSTOMER })
    )
    const result = shapeForPosting({
      posting: posting(),
      lines,
      roleByGlAccountId,
      counterparty: CUSTOMER,
      exportShape: 'auto',
      fullyPaidAtShipment: true,
    })

    expect(result.objectType).toBe('sales_receipt')
    expect(result.fallbackReason).toBeUndefined()
    const payload = result.payload as {
      depositTo: { glAccountId: string }
      lines: Array<{ glAccountId: string; taxCode?: string }>
    }
    expect(payload.depositTo).toEqual({
      glAccountId: 'acct_clearing',
      accountCode: 'ACCT_CLEARING',
    })
    expect(payload.lines).toHaveLength(2)
    // The sales-tax line gets `taxCode: 'NON'` (§7 D2); the revenue line does not.
    const taxLine = payload.lines.find((l) => l.glAccountId === 'acct_tax')
    const revenueLine = payload.lines.find((l) => l.glAccountId === 'acct_rev')
    expect(taxLine?.taxCode).toBe('NON')
    expect(revenueLine?.taxCode).toBeUndefined()
  })

  it('the same fulfillment not fully paid becomes an invoice', () => {
    const { lines, roleByGlAccountId } = withLines(
      line('acct_ar', 'accounts_receivable', 'debit', 5000, { counterparty: CUSTOMER }),
      line('acct_rev', 'revenue_product', 'credit', 5000)
    )
    const result = shapeForPosting({
      posting: posting(),
      lines,
      roleByGlAccountId,
      counterparty: CUSTOMER,
      exportShape: 'auto',
      fullyPaidAtShipment: false,
    })

    expect(result.objectType).toBe('invoice')
    const payload = result.payload as { customer: unknown; lines: unknown[] }
    expect(payload.customer).toEqual(CUSTOMER)
    expect(payload.lines).toHaveLength(1)
  })

  it('`exportShape: invoice` forces Invoice even when fully paid at shipment', () => {
    const { lines, roleByGlAccountId } = withLines(
      line('acct_ar', 'accounts_receivable', 'debit', 5000, { counterparty: CUSTOMER }),
      line('acct_rev', 'revenue_product', 'credit', 5000)
    )
    const result = shapeForPosting({
      posting: posting(),
      lines,
      roleByGlAccountId,
      counterparty: CUSTOMER,
      exportShape: 'invoice',
      fullyPaidAtShipment: true,
    })

    expect(result.objectType).toBe('invoice')
  })

  it('a standalone invoice_issued posting becomes an invoice', () => {
    const { lines, roleByGlAccountId } = withLines(
      line('acct_ar', 'accounts_receivable', 'debit', 3000, { counterparty: CUSTOMER }),
      line('acct_svc', 'revenue_service', 'credit', 3000)
    )
    const result = shapeForPosting({
      posting: posting({ postingType: 'invoice_issued', storeId: null, totalMinor: 3000 }),
      lines,
      roleByGlAccountId,
      counterparty: CUSTOMER,
      exportShape: 'auto',
    })

    expect(result.objectType).toBe('invoice')
  })

  it('a payment posting resolves to a payment applying to the fulfillment it settles', () => {
    const { lines, roleByGlAccountId } = withLines(
      line('acct_clearing', 'clearing', 'debit', 2000),
      line('acct_ar', 'accounts_receivable', 'credit', 2000, { counterparty: CUSTOMER })
    )
    const result = shapeForPosting({
      posting: posting({
        id: 'glp_pay',
        postingType: 'payment',
        totalMinor: 2000,
        docNumber: 'AUXX-PMT-1',
      }),
      lines,
      roleByGlAccountId,
      counterparty: CUSTOMER,
      exportShape: 'auto',
      appliesToGlPostingId: 'glp_1',
    })

    expect(result.objectType).toBe('payment')
    const payload = result.payload as { appliesTo: { glPostingId: string }; amountMinor: number }
    expect(payload.appliesTo).toEqual({ glPostingId: 'glp_1' })
    expect(payload.amountMinor).toBe(2000)
  })

  it('a credit memo becomes a credit_memo', () => {
    const { lines, roleByGlAccountId } = withLines(
      line('acct_returns', 'revenue_returns_allowances', 'debit', 1000),
      line('acct_ar', 'accounts_receivable', 'credit', 1000, { counterparty: CUSTOMER })
    )
    const result = shapeForPosting({
      posting: posting({
        id: 'glp_crm',
        postingType: 'credit_memo',
        totalMinor: 1000,
        docNumber: 'AUXX-CRM-1',
      }),
      lines,
      roleByGlAccountId,
      counterparty: CUSTOMER,
      exportShape: 'auto',
    })

    expect(result.objectType).toBe('credit_memo')
  })

  it('a refund becomes a refund_receipt', () => {
    const { lines, roleByGlAccountId } = withLines(
      line('acct_returns', 'revenue_returns_allowances', 'debit', 800),
      line('acct_clearing', 'clearing', 'credit', 800)
    )
    const result = shapeForPosting({
      posting: posting({
        id: 'glp_rfd',
        postingType: 'refund',
        totalMinor: 800,
        docNumber: 'AUXX-RFD-1',
      }),
      lines,
      roleByGlAccountId,
      counterparty: CUSTOMER,
      exportShape: 'auto',
    })

    expect(result.objectType).toBe('refund_receipt')
    expect((result.payload as { paidFrom: { glAccountId: string } }).paidFrom.glAccountId).toBe(
      'acct_clearing'
    )
  })

  it('a payout becomes a deposit with the fee line negative, net of the gross posting total', () => {
    const { lines, roleByGlAccountId } = withLines(
      line('acct_bank', 'bank', 'debit', 4700),
      line('acct_fees', 'payment_processing_fees', 'debit', 300),
      line('acct_clearing', 'clearing', 'credit', 5000)
    )
    const result = shapeForPosting({
      posting: posting({
        id: 'glp_pay1',
        postingType: 'payout',
        totalMinor: 5000,
        docNumber: 'AUXX-PAY-1',
      }),
      lines,
      roleByGlAccountId,
      counterparty: null,
      exportShape: 'auto',
    })

    expect(result.objectType).toBe('deposit')
    const payload = result.payload as { totalMinor: number; lines: Array<{ amountMinor: number }> }
    // The net that lands in the bank - not the entry's gross balancing total.
    expect(payload.totalMinor).toBe(4700)
    expect(payload.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amountMinor: 5000 }),
        expect.objectContaining({ amountMinor: -300 }),
      ])
    )
  })

  it('a bank deposit becomes a deposit with one positive line', () => {
    const { lines, roleByGlAccountId } = withLines(
      line('acct_bank', 'bank', 'debit', 1200),
      line('acct_undeposited', 'undeposited_funds', 'credit', 1200)
    )
    const result = shapeForPosting({
      posting: posting({
        id: 'glp_dep1',
        postingType: 'bank_deposit',
        totalMinor: 1200,
        docNumber: 'AUXX-DEP-1',
      }),
      lines,
      roleByGlAccountId,
      counterparty: null,
      exportShape: 'auto',
    })

    expect(result.objectType).toBe('deposit')
  })

  it('an expense bill becomes a bill', () => {
    const { lines, roleByGlAccountId } = withLines(
      line('acct_expense', null, 'debit', 600),
      line('acct_ap', 'accounts_payable', 'credit', 600)
    )
    const result = shapeForPosting({
      posting: posting({
        id: 'glp_bil1',
        postingType: 'expense_bill',
        totalMinor: 600,
        docNumber: 'AUXX-EXB-1',
      }),
      lines,
      roleByGlAccountId,
      counterparty: VENDOR,
      exportShape: 'auto',
    })

    expect(result.objectType).toBe('bill')
    expect((result.payload as { vendor: unknown }).vendor).toEqual(VENDOR)
  })

  it('a manual journal has no native shape and is a plain journal, not a fallback', () => {
    const { lines, roleByGlAccountId } = withLines(
      line('acct_a', null, 'debit', 100),
      line('acct_b', null, 'credit', 100)
    )
    const result = shapeForPosting({
      posting: posting({
        id: 'glp_jnl1',
        postingType: 'manual_journal',
        totalMinor: 100,
        docNumber: 'AUXX-JNL-1',
      }),
      lines,
      roleByGlAccountId,
      counterparty: null,
      exportShape: 'auto',
    })

    expect(result.objectType).toBe('journal')
    expect(result.fallbackReason).toBeUndefined()
  })

  it('a fulfillment whose lines do not fit an invoice falls back to journal, with a reason', () => {
    const { lines, roleByGlAccountId } = withLines(
      line('acct_ar', 'accounts_receivable', 'debit', 5000, { counterparty: CUSTOMER }),
      line('acct_unexpected', null, 'debit', 200),
      line('acct_rev', 'revenue_product', 'credit', 5200)
    )
    const result = shapeForPosting({
      posting: posting({ totalMinor: 5200 }),
      lines,
      roleByGlAccountId,
      counterparty: CUSTOMER,
      exportShape: 'auto',
      fullyPaidAtShipment: false,
    })

    expect(result.objectType).toBe('journal')
    expect(result.fallbackReason).toMatch(/invoice/i)
    // The fallback journal still carries every line, balanced.
    expect((result.payload as { lines: unknown[] }).lines).toHaveLength(3)
  })

  it('an invoice with no counterparty falls back to journal', () => {
    const { lines, roleByGlAccountId } = withLines(
      line('acct_ar', 'accounts_receivable', 'debit', 5000),
      line('acct_rev', 'revenue_product', 'credit', 5000)
    )
    const result = shapeForPosting({
      posting: posting(),
      lines,
      roleByGlAccountId,
      counterparty: null,
      exportShape: 'auto',
      fullyPaidAtShipment: false,
    })

    expect(result.objectType).toBe('journal')
    expect(result.fallbackReason).toBeDefined()
  })
})
