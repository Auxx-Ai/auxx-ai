// packages/lib/src/cache/providers/__tests__/chart-accounts-provider.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** systemAttribute -> the CustomField row, or absent to model an unmigrated org. */
  fields: new Map<string, { id: string; entityDefinitionId: string | null }>(),
}))

vi.mock('../../index', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(attrs.map((a) => [a, h.fields.get(a) ?? null])),
    }),
  }),
}))

import { chartProviderDb } from '../../../accounting/ledger/__tests__/support/chart-cache-stub'
import { chartAccountsProvider } from '../chart-accounts-provider'

const ORG = 'org_1'
const DEF = 'def_gl_account'

/** One account's `FieldValue` rows. */
function values(
  id: string,
  code: string | null,
  name: string,
  type: string | null,
  parent?: string
) {
  const rows: Record<string, unknown>[] = [{ entityId: id, fieldId: 'fld_name', valueText: name }]
  if (code !== null) rows.push({ entityId: id, fieldId: 'fld_code', valueText: code })
  if (type !== null) rows.push({ entityId: id, fieldId: 'fld_type', optionId: type })
  if (parent) rows.push({ entityId: id, fieldId: 'fld_parent', relatedEntityId: parent })
  return rows
}

beforeEach(() => {
  h.fields = new Map([
    ['gl_account_code', { id: 'fld_code', entityDefinitionId: DEF }],
    ['gl_account_name', { id: 'fld_name', entityDefinitionId: DEF }],
    ['gl_account_type', { id: 'fld_type', entityDefinitionId: DEF }],
    ['gl_account_parent', { id: 'fld_parent', entityDefinitionId: DEF }],
  ])
})

describe('chartAccountsProvider', () => {
  it('keeps archived rows and flags only those', async () => {
    const db = chartProviderDb(
      [{ id: 'a1' }, { id: 'a2', archived: true }],
      [...values('a1', '1000', 'Cash', 'asset'), ...values('a2', '1010', 'Petty', 'asset')]
    )
    const chart = await chartAccountsProvider.compute(ORG, db)

    expect(chart.map((row) => [row.id, row.isArchived])).toEqual([
      ['a1', undefined],
      ['a2', true],
    ])
  })

  it('returns [] for an org whose chart is not provisioned', async () => {
    h.fields.delete('gl_account_type')
    const db = chartProviderDb([{ id: 'a1' }], values('a1', '1000', 'Cash', 'asset'))
    expect(await chartAccountsProvider.compute(ORG, db)).toEqual([])
  })

  it('returns [] when the code field is attached to no definition', async () => {
    h.fields.set('gl_account_code', { id: 'fld_code', entityDefinitionId: null })
    const db = chartProviderDb([{ id: 'a1' }], values('a1', '1000', 'Cash', 'asset'))
    expect(await chartAccountsProvider.compute(ORG, db)).toEqual([])
  })

  it('skips an account with no type', async () => {
    const db = chartProviderDb(
      [{ id: 'a1' }, { id: 'a2' }],
      [...values('a1', '1000', 'Cash', 'asset'), ...values('a2', '1010', 'Untyped', null)]
    )
    const chart = await chartAccountsProvider.compute(ORG, db)
    expect(chart.map((row) => row.id)).toEqual(['a1'])
  })

  it('orders depth-first by the tree, siblings by code then name', async () => {
    const db = chartProviderDb(
      [{ id: 'sales' }, { id: 'cash' }, { id: 'product' }, { id: 'nocode' }, { id: 'service' }],
      [
        ...values('sales', '4000', 'Sales', 'revenue'),
        ...values('cash', '1000', 'Cash', 'asset'),
        ...values('service', '4020', 'Service', 'revenue', 'sales'),
        ...values('product', '4010', 'Product', 'revenue', 'sales'),
        ...values('nocode', null, 'Adjustments', 'equity'),
      ]
    )
    const chart = await chartAccountsProvider.compute(ORG, db)
    expect(chart.map((row) => row.id)).toEqual(['cash', 'sales', 'product', 'service', 'nocode'])
  })
})
