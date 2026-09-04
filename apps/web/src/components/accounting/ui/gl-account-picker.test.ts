// apps/web/src/components/accounting/ui/gl-account-picker.test.ts

import type { ChartAccountRow } from '@auxx/lib/postings/client'
import { describe, expect, it } from 'vitest'
import { groupAccountsByType } from './gl-account-picker'

function account(overrides: Partial<ChartAccountRow>): ChartAccountRow {
  return {
    id: overrides.id ?? overrides.code ?? 'acc',
    code: '1000',
    name: 'Account',
    accountType: 'asset',
    isActive: true,
    ...overrides,
  }
}

describe('groupAccountsByType', () => {
  const chart: ChartAccountRow[] = [
    account({ id: '1', code: '4020', name: 'Shipping Revenue', accountType: 'revenue' }),
    account({ id: '2', code: '1000', name: 'Cash', accountType: 'asset' }),
    account({ id: '3', code: '2000', name: 'Accounts Payable', accountType: 'liability' }),
    account({ id: '4', code: '3000', name: "Owner's Equity", accountType: 'equity' }),
    account({ id: '5', code: '6100', name: 'Rent Expense', accountType: 'expense' }),
    account({ id: '6', code: '1050', name: 'Undeposited Funds', accountType: 'asset' }),
  ]

  it('orders groups in statement order regardless of input order', () => {
    const groups = groupAccountsByType(chart, undefined, '')
    expect(groups.map((g) => g.type)).toEqual([
      'asset',
      'liability',
      'equity',
      'revenue',
      'expense',
    ])
  })

  it('keeps every account within its own group, unsorted beyond that', () => {
    const groups = groupAccountsByType(chart, undefined, '')
    const assetGroup = groups.find((g) => g.type === 'asset')
    expect(assetGroup?.accounts.map((a) => a.code)).toEqual(['1000', '1050'])
  })

  it('drops a group entirely once every member is filtered out', () => {
    const groups = groupAccountsByType(chart, undefined, 'rent')
    expect(groups).toHaveLength(1)
    expect(groups[0]?.type).toBe('expense')
  })

  it('restricts to filterTypes, still in statement order', () => {
    const groups = groupAccountsByType(chart, ['expense', 'asset'], '')
    expect(groups.map((g) => g.type)).toEqual(['asset', 'expense'])
  })

  it('matches search against code or name, case-insensitively', () => {
    const byCode = groupAccountsByType(chart, undefined, '1050')
    expect(byCode.flatMap((g) => g.accounts.map((a) => a.code))).toEqual(['1050'])

    const byName = groupAccountsByType(chart, undefined, 'UNDEPOSITED')
    expect(byName.flatMap((g) => g.accounts.map((a) => a.code))).toEqual(['1050'])
  })

  it('never returns a group with no matching accounts', () => {
    const groups = groupAccountsByType(chart, undefined, 'zzz-no-match')
    expect(groups).toEqual([])
  })
})
