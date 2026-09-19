// packages/lib/src/accounting/money/vendor-payments/__tests__/record-refund.test.ts
//
// The vendor refund writer: a `vendor_refund` movement plus one
// `MoneyRefundSettlement` naming the credit, and nothing written onto the
// credit by hand.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  inserts: [] as Array<[string, Record<string, unknown>]>,
  credit: {} as Record<string, unknown>,
  applied: 0,
  refunded: 0,
}))

vi.mock('../../commands/run-money-command', () => ({
  runMoneyCommand: async (
    db: unknown,
    _input: unknown,
    run: (tx: unknown, commandId: string) => unknown
  ) => run(db, 'cmd_1'),
}))
vi.mock('../../../../purchasing/vendor-credit/reads', () => ({
  requireVendorCredit: async () => h.credit,
  sumVendorCreditApplications: async () => h.applied,
  sumVendorCreditRefunds: async () => h.refunded,
}))
vi.mock('@auxx/database', () => ({
  database: {},
  schema: new Proxy({}, { get: (_t, table) => ({ __table: String(table) }) }),
}))

const { recordVendorRefund } = await import('../record-refund')

const input = {
  organizationId: 'org_1',
  userId: 'user_1',
  vendorCreditInstanceId: 'vc_1',
  amountMinor: 45_000,
  date: '2026-09-18',
  method: 'bank' as const,
  commandKey: 'dialog-1',
  reference: 'ACH-99',
}

function tx() {
  return {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const name = (table as { __table: string }).__table
        h.inserts.push([name, values])
        return { returning: async () => [{ id: `${name}-1` }] }
      },
    }),
  }
}

const run = (overrides: Partial<Parameters<typeof recordVendorRefund>[1]> = {}) =>
  recordVendorRefund(tx() as never, { ...input, ...overrides })

beforeEach(() => {
  h.inserts = []
  h.applied = 0
  h.refunded = 0
  h.credit = {
    id: 'vc_1',
    number: 'VC-0001',
    status: 'issued',
    totalMinor: 100_000,
    vendorCompanyInstanceId: 'co_1',
  }
})

describe('recordVendorRefund', () => {
  it('writes the movement and one settlement naming the credit', async () => {
    await expect(run()).resolves.toEqual({
      moneyTransactionId: 'MoneyTransaction-1',
      moneySettlementId: 'MoneyRefundSettlement-1',
    })
    expect(h.inserts.map(([table]) => table)).toEqual(['MoneyTransaction', 'MoneyRefundSettlement'])
    expect(h.inserts[0]![1]).toMatchObject({
      purpose: 'vendor_refund',
      amountMinor: 45_000n,
      currency: 'USD',
      datePrecision: 'date',
      occurredOn: '2026-09-18',
      partyInstanceId: 'co_1',
      cashAccountInstanceId: null,
      paymentGatewayId: null,
      method: 'bank',
      reference: 'ACH-99',
    })
    expect(h.inserts[1]![1]).toMatchObject({
      disposition: 'vendor_credit',
      vendorCreditInstanceId: 'vc_1',
      amountMinor: 45_000n,
      commandItemKey: 'vendor_credit_refund',
    })
  })

  it('stamps the bank account the money arrived in', async () => {
    await run({ bankAccountInstanceId: 'ba_1' })
    expect(h.inserts[0]![1]).toMatchObject({
      cashAccountInstanceId: 'ba_1',
      paymentGatewayId: null,
    })
  })

  it('stamps the rail the money arrived on', async () => {
    await run({ paymentGatewayId: 'pg_1' })
    expect(h.inserts[0]![1]).toMatchObject({
      cashAccountInstanceId: null,
      paymentGatewayId: 'pg_1',
    })
  })

  it('refuses a refund naming both a rail and a bank account', async () => {
    await expect(run({ paymentGatewayId: 'pg_1', bankAccountInstanceId: 'ba_1' })).rejects.toThrow(
      /never both/
    )
    expect(h.inserts).toEqual([])
  })

  it.each([0, -5, 12.5])('refuses the amount %s', async (amountMinor) => {
    await expect(run({ amountMinor })).rejects.toThrow(/positive whole number/)
    expect(h.inserts).toEqual([])
  })

  it('refuses a date that is not a calendar day', async () => {
    await expect(run({ date: '18/09/2026' })).rejects.toThrow(/calendar date/)
  })

  it('refuses more than the credit still carries', async () => {
    h.applied = 70_000
    await expect(run()).rejects.toThrow(/more than the 30000 cents/)
    expect(h.inserts).toEqual([])
  })

  it.each(['draft', 'settled', 'void'])('refuses a %s credit', async (status) => {
    h.credit = { ...h.credit, status }
    await expect(run()).rejects.toThrow()
    expect(h.inserts).toEqual([])
  })
})
