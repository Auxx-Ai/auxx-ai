// packages/lib/src/sales/credit-memos/__tests__/receipt-refund-endpoints.test.ts
//
// Where a refund of a receipt leaves by, read THROUGH the receipt's deposit
// (task 71 §B). A banked receipt's cash left the deposit's bank account, so
// refunding it back out of undeposited funds drives that account negative.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  depositBankAccounts: new Map<string, string | null>(),
  fieldContext: {} as unknown,
}))

vi.mock('@auxx/database', () => ({ database: {}, schema: new Proxy({}, { get: () => ({}) }) }))
vi.mock('../../../resources/system-records', () => ({
  systemFields: async () => h.fieldContext,
  readSystemRecords: async (_db: unknown, _org: string, _ctx: unknown, params: { ids: string[] }) =>
    params.ids.map((id) => ({
      id,
      related: () => h.depositBankAccounts.get(id) ?? null,
    })),
  systemFieldMap: () => ({}),
  systemValueJoin: () => ({}),
}))
vi.mock('../../../resources/registry/system-attributes', async () => ({
  ...(await vi.importActual<typeof import('../../../resources/registry/system-attributes')>(
    '../../../resources/registry/system-attributes'
  )),
  pickSystemAttributes: () => [],
}))

import type { Database } from '@auxx/database'
import { readReceiptRefundEndpoints } from '../reads'

const ORG = 'org_1'
const db = {} as Database

beforeEach(() => {
  h.depositBankAccounts = new Map([['dep_1', 'ba_deposit']])
  h.fieldContext = { defId: 'def_bank_deposit', fields: {} }
})

describe('readReceiptRefundEndpoints', () => {
  it('leaves an undeposited manual receipt in undeposited funds', async () => {
    const out = await readReceiptRefundEndpoints(db, ORG, [
      {
        id: 'mt_1',
        paymentGatewayId: null,
        cashAccountInstanceId: null,
        bankDepositInstanceId: null,
      },
    ])
    expect(out.get('mt_1')).toEqual({ paymentGatewayId: null, cashAccountInstanceId: null })
  })

  it("names the DEPOSIT's bank account once the receipt has been banked", async () => {
    const out = await readReceiptRefundEndpoints(db, ORG, [
      {
        id: 'mt_1',
        paymentGatewayId: null,
        cashAccountInstanceId: null,
        bankDepositInstanceId: 'dep_1',
      },
    ])
    expect(out.get('mt_1')).toEqual({
      paymentGatewayId: null,
      cashAccountInstanceId: 'ba_deposit',
    })
  })

  it('keeps a rail receipt on its rail, deposits or not', async () => {
    const out = await readReceiptRefundEndpoints(db, ORG, [
      {
        id: 'mt_1',
        paymentGatewayId: 'pg_1',
        cashAccountInstanceId: null,
        bankDepositInstanceId: null,
      },
    ])
    expect(out.get('mt_1')).toEqual({ paymentGatewayId: 'pg_1', cashAccountInstanceId: null })
  })

  it('keeps a receipt banked straight into an account on that account', async () => {
    const out = await readReceiptRefundEndpoints(db, ORG, [
      {
        id: 'mt_1',
        paymentGatewayId: null,
        cashAccountInstanceId: 'ba_direct',
        bankDepositInstanceId: null,
      },
    ])
    expect(out.get('mt_1')).toEqual({ paymentGatewayId: null, cashAccountInstanceId: 'ba_direct' })
  })

  it('falls back to the receipt when the deposit names no bank account', async () => {
    h.depositBankAccounts = new Map([['dep_1', null]])
    const out = await readReceiptRefundEndpoints(db, ORG, [
      {
        id: 'mt_1',
        paymentGatewayId: null,
        cashAccountInstanceId: null,
        bankDepositInstanceId: 'dep_1',
      },
    ])
    expect(out.get('mt_1')).toEqual({ paymentGatewayId: null, cashAccountInstanceId: null })
  })
})
