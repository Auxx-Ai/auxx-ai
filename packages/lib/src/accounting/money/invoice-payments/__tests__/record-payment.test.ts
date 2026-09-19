// packages/lib/src/accounting/money/invoice-payments/__tests__/record-payment.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const runMoneyCommand = vi.hoisted(() => vi.fn())
const loadInvoice = vi.hoisted(() => vi.fn())

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

describe('recordInvoicePayment cash endpoint', () => {
  it('records a payment with no endpoint — it waits in undeposited funds', async () => {
    await expect(recordInvoicePayment({} as never, input)).resolves.toEqual({
      moneyTransactionId: 'money-1',
      moneyApplicationId: 'app-1',
    })
    expect(runMoneyCommand.mock.calls[0]![1].payload).toMatchObject({
      paymentGatewayId: null,
      bankAccountInstanceId: null,
    })
  })

  it('records a payment into a named bank account, whatever the method', async () => {
    await recordInvoicePayment({} as never, {
      ...input,
      method: 'check',
      bankAccountInstanceId: 'bank-1',
    })
    expect(runMoneyCommand.mock.calls[0]![1].payload).toMatchObject({
      paymentGatewayId: null,
      bankAccountInstanceId: 'bank-1',
    })
  })

  it('records a payment onto a named rail', async () => {
    await recordInvoicePayment({} as never, { ...input, method: 'card', paymentGatewayId: 'pg-1' })
    expect(runMoneyCommand.mock.calls[0]![1].payload).toMatchObject({
      paymentGatewayId: 'pg-1',
      bankAccountInstanceId: null,
    })
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
      paymentGatewayId: null,
      bankAccountInstanceId: null,
    })
  })
})
