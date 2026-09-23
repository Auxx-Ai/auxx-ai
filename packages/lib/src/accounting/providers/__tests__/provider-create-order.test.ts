// packages/lib/src/accounting/providers/__tests__/provider-create-order.test.ts
//
// PURE: which of a selection goes to the provider, and in what order. Shared by
// `createProviderAccounts` and the chart tab's confirm preview, so it is pinned once here.

import { describe, expect, it } from 'vitest'
import type { AccountIdentityRow, ChartAccountRow, ProviderAccount } from '../../ledger/types'
import { providerCreateOrder } from '../provider-create-order'

function account(overrides: Partial<ChartAccountRow> & { id: string }): ChartAccountRow {
  return {
    code: '1000',
    name: 'Account',
    accountType: 'revenue',
    subtype: null,
    parentId: null,
    isActive: true,
    ...overrides,
  }
}

const chart: ChartAccountRow[] = [
  account({ id: 'sales', code: '4000', name: 'Sales' }),
  account({ id: 'service', code: '4010', name: 'Service Income', parentId: 'sales' }),
  account({ id: 'product', code: '4020', name: 'Product Income', parentId: 'sales' }),
  account({ id: 'physical', code: '4021', name: 'Physical Goods', parentId: 'product' }),
  account({ id: 'other', code: '4900', name: 'Other Revenue' }),
  account({ id: 'gone', code: '4950', name: 'Removed', isArchived: true }),
]

const PROVIDER_ACCOUNT: ProviderAccount = {
  id: 'qbo-1',
  name: 'Sales',
  fullyQualifiedName: 'Sales',
  number: '4000',
  accountType: 'Income',
  classification: 'revenue',
  active: true,
  parentId: null,
}

function identity(
  id: string,
  overrides: Partial<AccountIdentityRow> = {}
): [string, AccountIdentityRow] {
  const row = chart.find((a) => a.id === id) ?? account({ id })
  return [
    id,
    {
      account: row,
      state: 'unmapped',
      providerAccountId: null,
      providerAccountName: null,
      providerAccountNumber: null,
      source: null,
      confirmedAt: null,
      liveProviderAccount: null,
      suggestion: null,
      ...overrides,
    },
  ]
}

const linked = (id: string) =>
  identity(id, {
    state: 'confirmed',
    providerAccountId: 'qbo-1',
    liveProviderAccount: PROVIDER_ACCOUNT,
  })

describe('providerCreateOrder', () => {
  it('orders the selection parents first, in chart order, whatever the pick order was', () => {
    const order = providerCreateOrder(chart, new Map(), ['physical', 'other', 'sales', 'product'])
    expect(order.map((a) => a.id)).toEqual(['sales', 'product', 'physical', 'other'])
  })

  it('pulls in an unlinked ancestor outside the selection, ahead of its child', () => {
    const order = providerCreateOrder(chart, new Map(), ['physical'])
    expect(order.map((a) => a.id)).toEqual(['sales', 'product', 'physical'])
  })

  it('skips rows already linked, but still sends their unlinked children', () => {
    const byAccountId = new Map([linked('sales')])
    const order = providerCreateOrder(chart, byAccountId, ['sales', 'service', 'physical'])
    expect(order.map((a) => a.id)).toEqual(['service', 'product', 'physical'])
  })

  it('skips a row the matcher has a suggestion for, as the per-row button does', () => {
    const byAccountId = new Map([
      identity('other', { suggestion: { account: PROVIDER_ACCOUNT, reason: 'name' } }),
    ])
    const order = providerCreateOrder(chart, byAccountId, ['other', 'service'])
    expect(order.map((a) => a.id)).toEqual(['sales', 'service'])
  })

  it('skips a broken link rather than creating a second counterpart', () => {
    const byAccountId = new Map([
      identity('other', {
        state: 'confirmed',
        providerAccountId: 'qbo-9',
        liveProviderAccount: null,
      }),
    ])
    expect(providerCreateOrder(chart, byAccountId, ['other'])).toEqual([])
  })

  it('skips archived rows and ids the chart does not hold', () => {
    const order = providerCreateOrder(chart, new Map(), ['gone', 'nope', 'other'])
    expect(order.map((a) => a.id)).toEqual(['other'])
  })
})
