// packages/lib/src/money/invoices/__tests__/payment-reads.test.ts

import { describe, expect, it } from 'vitest'
import { listInvoiceMoneyPayments } from '../payment-reads'

type Row = {
  amountMinor: bigint
  operation: 'apply' | 'unapply'
  moneyTransactionId: string
  createdAt: Date
  purpose: string
  occurredAt: Date | null
  occurredOn: string | null
  method: string | null
  reference: string | null
  note: string | null
}

/** A stub standing in for the one select-with-join this module runs. */
function stubDb(rows: Row[]) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: async () => rows,
  }
  return { select: () => chain } as never
}

const base: Row = {
  amountMinor: 12_000n,
  operation: 'apply',
  moneyTransactionId: 'money-1',
  createdAt: new Date('2026-09-15T00:00:00Z'),
  purpose: 'customer_receipt',
  occurredAt: null,
  occurredOn: '2026-09-15',
  method: 'check',
  reference: '1234',
  note: null,
}

const params = { organizationId: 'org', invoiceInstanceId: 'invoice-1' }

describe('listInvoiceMoneyPayments', () => {
  it('shapes a recorded receipt for the drawer, marked as the money lane', async () => {
    const [row] = await listInvoiceMoneyPayments(stubDb([base]), params)
    expect(row).toMatchObject({
      id: 'money-1',
      amount: 12_000,
      allocatedAmount: 12_000,
      kind: 'charge',
      status: 'succeeded',
      date: '2026-09-15',
      method: 'check',
      reference: '1234',
      // `payments-list.tsx` gates Delete on `'manual'`, so this row shows no
      // action it cannot perform.
      provider: 'money',
    })
  })

  it('trims an instant down to its day', async () => {
    const [row] = await listInvoiceMoneyPayments(
      stubDb([{ ...base, occurredOn: null, occurredAt: new Date('2026-09-15T22:30:00Z') }]),
      params
    )
    expect(row?.date).toBe('2026-09-15')
  })

  it('nets an unapply against its apply', async () => {
    const rows = await listInvoiceMoneyPayments(
      stubDb([base, { ...base, operation: 'unapply', amountMinor: 5_000n }]),
      params
    )
    expect(rows[0]?.amount).toBe(7_000)
  })

  it('drops a receipt that was fully unapplied off this invoice', async () => {
    const rows = await listInvoiceMoneyPayments(
      stubDb([base, { ...base, operation: 'unapply', amountMinor: 12_000n }]),
      params
    )
    expect(rows).toEqual([])
  })

  it('keeps two separate receipts apart', async () => {
    const rows = await listInvoiceMoneyPayments(
      stubDb([base, { ...base, moneyTransactionId: 'money-2', amountMinor: 3_000n }]),
      params
    )
    expect(rows.map((r) => [r.id, r.amount])).toEqual([
      ['money-1', 12_000],
      ['money-2', 3_000],
    ])
  })
})
