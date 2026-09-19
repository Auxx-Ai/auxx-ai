// packages/lib/src/accounting/money/vendor-payments/__tests__/payment-state.test.ts
//
// The bill's `amount_paid` / `paid_at` / `payment_status` are a PROJECTION of
// its applications and its credits. Nothing else writes them, and nothing here
// writes `vendor_bill_status` (73 D1).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  applications: [] as Array<Record<string, unknown>>,
  scalars: new Map<string, unknown>(),
  writes: [] as Array<Array<{ fieldId: string; value: unknown }>>,
}))

vi.mock('@auxx/database', () => ({ database: {}, schema: new Proxy({}, { get: () => ({}) }) }))
vi.mock('drizzle-orm', () => ({ and: () => undefined, eq: () => undefined }))
vi.mock('../../../../cache', () => ({
  getEntityDefIdResolver: async () => () => 'def_vendor_bill',
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async () => ({
        vendor_bill_total: { id: 'f_total', type: 'CURRENCY' },
        vendor_bill_payment_status: { id: 'f_pay_status', type: 'SINGLE_SELECT' },
        vendor_bill_amount_paid: { id: 'f_paid', type: 'CURRENCY' },
        vendor_bill_amount_credited: { id: 'f_credited', type: 'CURRENCY' },
        vendor_bill_paid_at: { id: 'f_paid_at', type: 'DATETIME' },
      }),
    }),
  }),
}))
vi.mock('../../../../field-values/read-field-scalars', () => ({
  readFieldScalars: async () => new Map([['vb_1', h.scalars]]),
}))
vi.mock('../../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    setValuesForEntity = async (input: { values: Array<{ fieldId: string; value: unknown }> }) => {
      h.writes.push(input.values)
    }
  },
}))

import type { Database } from '@auxx/database'
import { syncVendorBillPaymentState } from '../payment-state'

const db = {
  query: { MoneyApplication: { findMany: async () => h.applications } },
} as unknown as Database

const run = () =>
  syncVendorBillPaymentState(db, {
    organizationId: 'org_1',
    userId: 'user_1',
    vendorBillInstanceId: 'vb_1',
  })

const last = () => h.writes.at(-1) ?? []

beforeEach(() => {
  h.writes = []
  h.applications = []
  h.scalars = new Map<string, unknown>([
    ['f_total', 100_000],
    ['f_pay_status', 'unpaid'],
    ['f_paid', 0],
    ['f_credited', 0],
  ])
})

describe('syncVendorBillPaymentState', () => {
  it('marks a fully settled bill paid on the latest application date', async () => {
    h.applications = [
      { operation: 'apply', amountMinor: 40_000n, effectiveDate: '2026-09-01' },
      { operation: 'apply', amountMinor: 60_000n, effectiveDate: '2026-09-20' },
    ]
    await run()
    expect(last()).toContainEqual({ fieldId: 'f_paid', value: 100_000 })
    expect(last()).toContainEqual({ fieldId: 'f_pay_status', value: 'paid' })
    expect(last()).toContainEqual({
      fieldId: 'f_paid_at',
      value: '2026-09-20T00:00:00.000Z',
    })
  })

  it('marks a part-settled bill partially_paid and clears the paid date', async () => {
    h.applications = [{ operation: 'apply', amountMinor: 40_000n, effectiveDate: '2026-09-01' }]
    await run()
    expect(last()).toContainEqual({ fieldId: 'f_paid', value: 40_000 })
    expect(last()).toContainEqual({ fieldId: 'f_pay_status', value: 'partially_paid' })
    expect(last()).toContainEqual({ fieldId: 'f_paid_at', value: null })
  })

  it('nets an unapply back out and returns the bill to unpaid', async () => {
    h.scalars.set('f_pay_status', 'paid')
    h.scalars.set('f_paid', 100_000)
    h.applications = [
      { operation: 'apply', amountMinor: 100_000n, effectiveDate: '2026-09-01' },
      { operation: 'unapply', amountMinor: 100_000n, effectiveDate: '2026-09-22' },
    ]
    await run()
    expect(last()).toContainEqual({ fieldId: 'f_paid', value: 0 })
    expect(last()).toContainEqual({ fieldId: 'f_pay_status', value: 'unpaid' })
  })

  it('counts a vendor credit towards settlement, so cash plus credit pays the bill', async () => {
    h.scalars.set('f_credited', 60_000)
    h.applications = [{ operation: 'apply', amountMinor: 40_000n, effectiveDate: '2026-09-01' }]
    await run()
    expect(last()).toContainEqual({ fieldId: 'f_pay_status', value: 'paid' })
  })

  it('never writes the lifecycle field, whatever the bill is settled to', async () => {
    h.applications = [{ operation: 'apply', amountMinor: 100_000n, effectiveDate: '2026-09-01' }]
    await run()
    for (const write of h.writes.flat()) expect(write.fieldId).not.toBe('f_status')
  })
})
