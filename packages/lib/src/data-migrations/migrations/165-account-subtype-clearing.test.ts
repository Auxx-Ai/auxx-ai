// packages/lib/src/data-migrations/migrations/165-account-subtype-clearing.test.ts
//
// `mergeSubtypeOptions` is pure, so the rule that protects 16 stored
// `FieldValue.optionId` rows is testable without a database. The load-bearing
// assertion is the negative one: no existing `value` is ever rewritten.

import { describe, expect, it } from 'vitest'
import { GlAccountSubtype } from '../../resources/registry/enum-values'
import { mergeSubtypeOptions } from './165-account-subtype-clearing'

/** The eight options every org was seeded with before this migration. */
const EIGHT = [
  { value: 'bank', label: 'Bank', color: 'blue' },
  { value: 'accounts_receivable', label: 'Accounts receivable', color: 'blue' },
  { value: 'accounts_payable', label: 'Accounts payable', color: 'amber' },
  { value: 'credit_card', label: 'Credit card', color: 'amber' },
  { value: 'inventory', label: 'Inventory', color: 'purple' },
  { value: 'fixed_asset', label: 'Fixed asset', color: 'purple' },
  { value: 'cost_of_goods_sold', label: 'Cost of goods sold', color: 'red' },
  { value: 'other', label: 'Other', color: 'gray' },
]

const registry = GlAccountSubtype.values as { value: string; label: string }[]

describe('mergeSubtypeOptions', () => {
  it('adds the three new subtypes to a seeded org', () => {
    const next = mergeSubtypeOptions(EIGHT, registry)
    expect(next).not.toBeNull()
    expect(next?.map((o) => o.value)).toEqual([
      'bank',
      'accounts_receivable',
      'accounts_payable',
      'credit_card',
      'inventory',
      'fixed_asset',
      'cost_of_goods_sold',
      'clearing',
      'reserve_balances',
      'stored_balances',
      'other',
    ])
  })

  it('keeps Other last rather than appending the new values after it', () => {
    const next = mergeSubtypeOptions(EIGHT, registry)
    expect(next?.at(-1)?.value).toBe('other')
  })

  it('never rewrites a stored value, which is what FieldValue.optionId points at', () => {
    const next = mergeSubtypeOptions(EIGHT, registry)
    for (const original of EIGHT) {
      expect(next).toContainEqual(original)
    }
  })

  it('preserves a label an org renamed itself', () => {
    const renamed = EIGHT.map((o) => (o.value === 'bank' ? { ...o, label: 'Bank accounts' } : o))
    const next = mergeSubtypeOptions(renamed, registry)
    expect(next?.find((o) => o.value === 'bank')?.label).toBe('Bank accounts')
  })

  it("keeps an org's own extra option rather than dropping it", () => {
    const withCustom = [...EIGHT, { value: 'escrow', label: 'Escrow', color: 'teal' }]
    const next = mergeSubtypeOptions(withCustom, registry)
    expect(next?.find((o) => o.value === 'escrow')).toEqual({
      value: 'escrow',
      label: 'Escrow',
      color: 'teal',
    })
  })

  it('is idempotent — a second run reports no change', () => {
    const first = mergeSubtypeOptions(EIGHT, registry)
    expect(first).not.toBeNull()
    expect(mergeSubtypeOptions(first!, registry)).toBeNull()
  })

  it('reports no change for an org already carrying the registry list', () => {
    expect(mergeSubtypeOptions(registry, registry)).toBeNull()
  })
})
