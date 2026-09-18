// apps/web/src/components/accounting/ui/chart-account-create-dialog.test.ts

import type { ChartAccountRow } from '@auxx/lib/accounting/ledger/client'
import { describe, expect, it } from 'vitest'
import { resolveAccountTypeForParent } from './chart-account-create-dialog'

function account(overrides: Partial<ChartAccountRow>): ChartAccountRow {
  return {
    id: overrides.id ?? overrides.code ?? 'acc',
    code: '1000',
    name: 'Account',
    accountType: 'asset',
    subtype: null,
    parentId: null,
    isActive: true,
    ...overrides,
  }
}

describe('resolveAccountTypeForParent', () => {
  const accounts: ChartAccountRow[] = [
    account({ id: 'checking', code: '1000', name: 'Checking', accountType: 'asset' }),
    account({ id: 'sales', code: '4000', name: 'Sales', accountType: 'revenue' }),
  ]

  it('locks to the chosen parent’s statement type, regardless of what was picked before', () => {
    expect(resolveAccountTypeForParent('sales', accounts, 'asset')).toBe('revenue')
    expect(resolveAccountTypeForParent('checking', accounts, 'revenue')).toBe('asset')
  })

  it('clearing the parent (null) leaves the current type alone', () => {
    expect(resolveAccountTypeForParent(null, accounts, 'revenue')).toBe('revenue')
    expect(resolveAccountTypeForParent(null, accounts, null)).toBeNull()
  })

  it('an id the fetched chart does not hold yet falls back to the current type', () => {
    expect(resolveAccountTypeForParent('not-loaded-yet', accounts, 'expense')).toBe('expense')
  })
})
