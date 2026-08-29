// packages/lib/src/postings/__tests__/regime.test.ts
//
// gap-e risk E5. This is the ONLY mechanical guard that L1 and L3 are not both
// live, and the thing it guards against produces two entries that each balance
// perfectly - so nothing else, anywhere, can catch it.

import { describe, expect, it } from 'vitest'
import { ACCOUNT_ROLES } from '../build-entry'
import {
  ENABLED_POSTING_TYPES,
  findInventoryWriterConflicts,
  INVENTORY_ROLES,
  INVENTORY_ROLES_BY_POSTING_TYPE,
} from '../regime'
import { POSTING_TYPES } from '../types'

describe('the enabled regime', () => {
  it('has NO inventory account with two writers', () => {
    // The assertion itself. If this ever fails, a close is both asserting a
    // balance and accumulating postings into the same account: the monthly
    // entry reverses the per-event ones and the residual lands in the COGS
    // plug looking like consumption.
    expect(findInventoryWriterConflicts()).toEqual([])
  })

  it('is L1 only - `receipt` and `vendor_bill` exist but are not enabled', () => {
    // They are in `POSTING_TYPES`, in the pgEnum, and their builders are written
    // and tested. Being buildable is not being enabled, which is the whole
    // reason this constant exists separately from the union.
    expect([...ENABLED_POSTING_TYPES]).toEqual(['month_end_inventory'])
    expect(ENABLED_POSTING_TYPES).not.toContain('receipt')
    expect(ENABLED_POSTING_TYPES).not.toContain('vendor_bill')
  })
})

describe('the conflict detector actually bites', () => {
  it('catches the L1+L3 state that turning L3 on WITHOUT turning L1 off would create', () => {
    // The realistic mistake: someone adds the L3 types and leaves the monthly
    // assertion in place. `vendor_bill` touches no inventory account, so the
    // conflict is `receipt` against `month_end_inventory` - on exactly the two
    // accounts a receipt can debit.
    const conflicts = findInventoryWriterConflicts([
      'month_end_inventory',
      'receipt',
      'vendor_bill',
    ])

    expect(conflicts.map((c) => c.role).sort()).toEqual(
      [ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS, ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS].sort()
    )
    for (const conflict of conflicts) {
      expect(conflict.postingTypes.sort()).toEqual(['month_end_inventory', 'receipt'])
    }
  })

  it('passes for a clean L3 switch - the monthly assertion turned OFF', () => {
    // Turning L3 on is ONE change: swap the contents, do not extend them.
    expect(findInventoryWriterConflicts(['receipt', 'vendor_bill'])).toEqual([])
  })

  it('does not flag WIP, which no builder drives per-event', () => {
    const conflicts = findInventoryWriterConflicts(['month_end_inventory', 'receipt'])
    expect(conflicts.map((c) => c.role)).not.toContain(ACCOUNT_ROLES.INVENTORY_WIP)
  })
})

describe('the declaration cannot drift from the vocabulary', () => {
  it('declares an entry for every posting type', () => {
    // A type with no entry would read as "drives nothing" and be invisible to
    // the assertion - the failure mode is silence, so pin the key set.
    expect(Object.keys(INVENTORY_ROLES_BY_POSTING_TYPE).sort()).toEqual([...POSTING_TYPES].sort())
  })

  it('every enabled type is a real posting type', () => {
    for (const type of ENABLED_POSTING_TYPES) expect(POSTING_TYPES).toContain(type)
  })

  it('names exactly the three inventory roles', () => {
    expect([...INVENTORY_ROLES].sort()).toEqual(
      [
        ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
        ACCOUNT_ROLES.INVENTORY_WIP,
        ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
      ].sort()
    )
  })

  it('only ever declares real account roles', () => {
    const valid = new Set<string>(Object.values(ACCOUNT_ROLES))
    for (const roles of Object.values(INVENTORY_ROLES_BY_POSTING_TYPE)) {
      for (const role of roles) expect(valid.has(role)).toBe(true)
    }
  })
})
