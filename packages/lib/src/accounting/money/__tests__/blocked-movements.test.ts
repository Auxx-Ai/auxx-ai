// packages/lib/src/accounting/money/__tests__/blocked-movements.test.ts
//
// The dispatcher (75-D1): which poster a parked movement belongs to is read off
// its evidence - the applications and the purpose - never off a provider key.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  customerReceipt: vi.fn(),
  invoiceReceipt: vi.fn(),
  customerRefund: vi.fn(),
  vendorPayment: vi.fn(),
  vendorRefund: vi.fn(),
  money: null as unknown,
  applications: [] as Array<{ invoiceInstanceId: string | null; orderInstanceId: string | null }>,
}))

vi.mock('../customer-money/accounting', () => ({
  postCustomerReceiptAccounting: h.customerReceipt,
}))
vi.mock('../customer-money/refund-accounting', () => ({
  postCustomerRefundAccounting: h.customerRefund,
}))
vi.mock('../invoice-payments/receipt-accounting', () => ({
  acceptInvoiceReceiptAccounting: h.invoiceReceipt,
}))
vi.mock('../vendor-payments/payment-accounting', () => ({
  acceptVendorPaymentAccounting: h.vendorPayment,
}))
vi.mock('../vendor-payments/refund-accounting', () => ({
  postVendorRefundAccounting: h.vendorRefund,
}))

import type { Database } from '@auxx/database'
import { NotFoundError } from '../../../errors'
import { postBlockedMovement } from '../blocked-movements'

const ORG = 'org_1'
const MOVEMENT = 'mt_1'

function db(): Database {
  const chain = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'orderBy']) self[method] = () => self
    // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
    self.then = (resolve: (v: unknown) => unknown) => Promise.resolve(h.applications).then(resolve)
    return self
  }
  return {
    query: {
      MoneyTransaction: {
        findMany: async () => (h.money ? [h.money] : []),
      },
      MoneyApplication: { findMany: async () => h.applications },
    },
    select: () => chain(),
  } as unknown as Database
}

const retry = () => postBlockedMovement(db(), { organizationId: ORG, moneyTransactionId: MOVEMENT })

beforeEach(() => {
  vi.clearAllMocks()
  h.applications = []
  h.money = { id: MOVEMENT, organizationId: ORG, purpose: 'customer_receipt' }
  for (const poster of [
    h.customerReceipt,
    h.invoiceReceipt,
    h.customerRefund,
    h.vendorPayment,
    h.vendorRefund,
  ])
    poster.mockResolvedValue({ status: 'accepted', glPostingId: 'gl_1' })
})

describe('postBlockedMovement', () => {
  it('sends a vendor payment to the vendor-payment poster', async () => {
    h.money = { id: MOVEMENT, organizationId: ORG, purpose: 'vendor_payment' }
    await expect(retry()).resolves.toEqual({ status: 'accepted', glPostingId: 'gl_1' })
    expect(h.vendorPayment).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      moneyTransactionId: MOVEMENT,
    })
    expect(h.customerReceipt).not.toHaveBeenCalled()
  })

  it('sends a vendor refund to the vendor-refund poster', async () => {
    h.money = { id: MOVEMENT, organizationId: ORG, purpose: 'vendor_refund' }
    await retry()
    expect(h.vendorRefund).toHaveBeenCalledOnce()
  })

  it('sends a customer refund to the customer-refund poster', async () => {
    h.money = { id: MOVEMENT, organizationId: ORG, purpose: 'customer_refund' }
    await retry()
    expect(h.customerRefund).toHaveBeenCalledOnce()
  })

  it('sends an order receipt to the receipt poster and an invoice receipt to the invoice one', async () => {
    h.applications = [{ invoiceInstanceId: null, orderInstanceId: 'ord_1' }]
    await retry()
    expect(h.customerReceipt).toHaveBeenCalledOnce()
    expect(h.invoiceReceipt).not.toHaveBeenCalled()

    h.applications = [{ invoiceInstanceId: 'inv_1', orderInstanceId: null }]
    await retry()
    expect(h.invoiceReceipt).toHaveBeenCalledOnce()
  })

  it('sends a receipt applied to nothing yet to the receipt poster (91 §8.6)', async () => {
    await expect(retry()).resolves.toEqual({ status: 'accepted', glPostingId: 'gl_1' })
    expect(h.customerReceipt).toHaveBeenCalledOnce()
    expect(h.invoiceReceipt).not.toHaveBeenCalled()
  })

  it('refuses a movement that does not exist', async () => {
    h.money = undefined
    await expect(retry()).rejects.toBeInstanceOf(NotFoundError)
  })

  it('hands the refusal back rather than throwing when the poster still blocks', async () => {
    h.money = { id: MOVEMENT, organizationId: ORG, purpose: 'vendor_payment' }
    h.vendorPayment.mockResolvedValue({ status: 'blocked', reason: 'Cannot post: …' })
    await expect(retry()).resolves.toEqual({ status: 'blocked', reason: 'Cannot post: …' })
  })
})
