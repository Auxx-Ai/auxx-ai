// packages/lib/src/accounting/ledger/chart/__tests__/propose-role-account.test.ts

import { describe, expect, it } from 'vitest'
import { proposeRoleAccount } from '../propose-role-account'

type Row = Parameters<typeof proposeRoleAccount>[1][number]

function row(partial: Partial<Row> & { id: string }): Row {
  return { code: null, accountType: 'asset', subtype: null, parentId: null, ...partial }
}

describe('proposeRoleAccount', () => {
  it('takes name, type and subtype from the default chart', () => {
    const proposal = proposeRoleAccount('inventory_wip', [])
    expect(proposal).toMatchObject({
      name: 'Work in Process',
      accountType: 'asset',
      subtype: 'inventory',
      code: null,
      parentId: null,
    })
  })

  it('appends the scope to the name', () => {
    expect(proposeRoleAccount('accounts_receivable', [], { scopeLabel: 'Shopify US' }).name).toBe(
      'Accounts Receivable · Shopify US'
    )
  })

  it('uses our band in a chart numbered the way ours is, nested beside its neighbour', () => {
    const chart = [
      row({ id: 'inv', code: '1300', subtype: 'inventory' }),
      row({ id: 'raw', code: '1310', subtype: 'inventory', parentId: 'inv' }),
      row({ id: 'wipTaken', code: '1320', subtype: 'inventory', parentId: 'inv' }),
      row({ id: 'cash', code: '1000' }),
    ]
    expect(proposeRoleAccount('inventory_wip', chart)).toMatchObject({
      code: '1321',
      parentId: 'inv',
    })
  })

  it('follows the org numbering when it differs from ours', () => {
    const chart = [
      row({ id: 'bank', code: '10000' }),
      row({ id: 'invParent', code: '12000', subtype: 'inventory' }),
      row({ id: 'raw', code: '12100', subtype: 'inventory', parentId: 'invParent' }),
      row({ id: 'exp', code: '60000', accountType: 'expense' }),
    ]
    expect(proposeRoleAccount('inventory_wip', chart)).toMatchObject({
      code: '12101',
      parentId: 'invParent',
    })
  })

  it('ignores archived accounts', () => {
    const chart = [
      row({ id: 'cash', code: '1000' }),
      row({ id: 'old', code: '1320', isArchived: true }),
    ]
    expect(proposeRoleAccount('inventory_wip', chart).code).toBe('1320')
  })

  it('finds a parent through a sibling role in an unnumbered chart', () => {
    const chart = [
      row({ id: 'inv', subtype: 'inventory' }),
      row({ id: 'raw', subtype: 'inventory', parentId: 'inv' }),
    ]
    const proposal = proposeRoleAccount('inventory_wip', chart, {
      roleAccounts: [{ role: 'inventory_raw_materials', accountId: 'raw' }],
    })
    expect(proposal).toMatchObject({ code: null, parentId: 'inv' })
  })

  it('names a role with no default account by its label', () => {
    expect(proposeRoleAccount('bank', [], { scopeLabel: 'Chase' })).toMatchObject({
      accountType: 'asset',
      subtype: 'bank',
    })
  })
})
