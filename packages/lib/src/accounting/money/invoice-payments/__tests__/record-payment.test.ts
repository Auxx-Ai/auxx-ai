// packages/lib/src/accounting/money/invoice-payments/__tests__/record-payment.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
const runMoneyCommand = vi.hoisted(() => vi.fn())
const loadInvoice = vi.hoisted(() => vi.fn())

vi.mock('../../../../cache/singletons', () => ({
  getOrgCache: () => ({ get: async () => settings.value }),
}))
vi.mock('../../commands/run-money-command', () => ({ runMoneyCommand }))
vi.mock('../../../../sales/invoices/issuance-reads', () => ({
  loadInvoiceForIssuance: loadInvoice,
}))

const { recordInvoicePayment } = await import('../record-payment')

const input = {
  organizationId: 'org',
  userId: 'user',
  invoiceInstanceId: 'invoice-1',
  amountMinor: 12_000,
  date: '2026-09-15',
  method: 'check' as const,
  commandKey: 'dialog-1',
}

beforeEach(() => {
  settings.value = {}
  runMoneyCommand.mockReset()
  runMoneyCommand.mockResolvedValue({ moneyTransactionId: 'money-1', moneyApplicationId: 'app-1' })
  loadInvoice.mockReset()
})

describe('recordInvoicePayment input guards', () => {
  it('refuses a zero or negative amount', async () => {
    await expect(recordInvoicePayment({} as never, { ...input, amountMinor: 0 })).rejects.toThrow(
      /positive whole number/
    )
    await expect(recordInvoicePayment({} as never, { ...input, amountMinor: -5 })).rejects.toThrow(
      /positive whole number/
    )
  })

  it('refuses a fractional amount — minor units are whole cents', async () => {
    await expect(recordInvoicePayment({} as never, { ...input, amountMinor: 1.5 })).rejects.toThrow(
      /positive whole number/
    )
  })

  it('refuses a malformed date', async () => {
    await expect(
      recordInvoicePayment({} as never, { ...input, date: '15/09/2026' })
    ).rejects.toThrow(/calendar date/)
  })
})

describe('recordInvoicePayment route rules', () => {
  it('records a cheque with no bank account — it waits in undeposited funds', async () => {
    await expect(recordInvoicePayment({} as never, input)).resolves.toEqual({
      moneyTransactionId: 'money-1',
      moneyApplicationId: 'app-1',
    })
    expect(runMoneyCommand).toHaveBeenCalledOnce()
  })

  it('refuses a cheque that names a bank account', async () => {
    await expect(
      recordInvoicePayment({} as never, { ...input, bankAccountInstanceId: 'bank-1' })
    ).rejects.toThrow(/undeposited funds/)
  })

  it('requires a bank account for a bank transfer, which routes straight to cash', async () => {
    await expect(recordInvoicePayment({} as never, { ...input, method: 'bank' })).rejects.toThrow(
      /bank account this payment landed in/
    )
  })

  it('accepts a bank transfer that names one', async () => {
    await expect(
      recordInvoicePayment({} as never, {
        ...input,
        method: 'bank',
        bankAccountInstanceId: 'bank-1',
      })
    ).resolves.toMatchObject({ moneyTransactionId: 'money-1' })
  })

  it('lets a hand-recorded card payment sit in undeposited funds', async () => {
    // Card routes to `clearing` by default, but a terminal auxx knows nothing
    // about produces no payout to drain it.
    await expect(
      recordInvoicePayment({} as never, { ...input, method: 'card' })
    ).resolves.toMatchObject({ moneyTransactionId: 'money-1' })
  })

  it('lets a hand-recorded card payment name the bank it was deposited into', async () => {
    await expect(
      recordInvoicePayment({} as never, {
        ...input,
        method: 'card',
        bankAccountInstanceId: 'bank-1',
      })
    ).resolves.toMatchObject({ moneyTransactionId: 'money-1' })
  })

  it('obeys an org that has re-routed cheques to a bank account', async () => {
    settings.value = { 'accounting.paymentRoute.check': 'cash' }
    await expect(recordInvoicePayment({} as never, input)).rejects.toThrow(
      /bank account this payment landed in/
    )
  })

  it('treats a blank bank account as none, not as a named one', async () => {
    await expect(
      recordInvoicePayment({} as never, { ...input, bankAccountInstanceId: '   ' })
    ).resolves.toMatchObject({ moneyApplicationId: 'app-1' })
  })
})

describe('recordInvoicePayment command identity', () => {
  it('passes the caller key through, so a double-submitted dialog records once', async () => {
    await recordInvoicePayment({} as never, input)
    expect(runMoneyCommand.mock.calls[0]![1]).toMatchObject({
      commandKey: 'dialog-1',
      kind: 'record_invoice_payment',
    })
  })

  it('keys the payload on what the money IS, so a retry with a changed amount conflicts', async () => {
    await recordInvoicePayment({} as never, input)
    expect(runMoneyCommand.mock.calls[0]![1].payload).toEqual({
      invoiceInstanceId: 'invoice-1',
      amountMinor: 12_000,
      date: '2026-09-15',
      method: 'check',
      bankAccountInstanceId: null,
    })
  })
})
