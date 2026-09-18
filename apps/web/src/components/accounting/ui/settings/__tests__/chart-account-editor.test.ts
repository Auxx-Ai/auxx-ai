// apps/web/src/components/accounting/ui/settings/__tests__/chart-account-editor.test.ts

import type { ChartAccountRow } from '@auxx/lib/accounting/ledger/client'
import { describe, expect, it } from 'vitest'
import { resolveAccountTypeForParent } from '../accounts-types'
import { parentPickerExcludeIds } from '../chart-account-editor'

function account(overrides: Partial<ChartAccountRow>): ChartAccountRow {
  return {
    id: overrides.id ?? overrides.code ?? 'acc',
    code: '1000',
    name: 'Account',
    accountType: 'revenue',
    subtype: null,
    parentId: null,
    isActive: true,
    ...overrides,
  }
}

describe('parentPickerExcludeIds', () => {
  const nested: ChartAccountRow[] = [
    account({ id: 'sales', code: '4000', name: 'Sales' }),
    account({ id: 'service', code: '4010', name: 'Service Income', parentId: 'sales' }),
    account({ id: 'product', code: '4020', name: 'Product Income', parentId: 'sales' }),
    account({ id: 'physical', code: '4021', name: 'Physical Goods', parentId: 'product' }),
    account({ id: 'other', code: '4900', name: 'Other Revenue' }),
  ]

  it('excludes the account itself and every descendant, at every depth', () => {
    const excluded = parentPickerExcludeIds(nested, 'sales')
    expect([...excluded].sort()).toEqual(['physical', 'product', 'sales', 'service'].sort())
  })

  it('leaves everything else - siblings, unrelated accounts - candidates', () => {
    const excluded = parentPickerExcludeIds(nested, 'product')
    expect(excluded.has('sales')).toBe(false)
    expect(excluded.has('service')).toBe(false)
    expect(excluded.has('other')).toBe(false)
    expect([...excluded].sort()).toEqual(['physical', 'product'].sort())
  })

  it('a leaf with no descendants excludes only itself', () => {
    const excluded = parentPickerExcludeIds(nested, 'physical')
    expect([...excluded]).toEqual(['physical'])
  })
})

describe('resolveAccountTypeForParent (draft unwedging)', () => {
  const accounts: ChartAccountRow[] = [
    account({ id: 'sales', code: '4000', name: 'Sales', accountType: 'revenue' }),
  ]

  it('choosing a parent on a not-yet-typed draft yields the parent’s type, not null', () => {
    expect(resolveAccountTypeForParent('sales', accounts, null)).toBe('revenue')
  })
})
