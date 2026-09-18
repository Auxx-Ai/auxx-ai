// packages/lib/src/inventory/movements/__tests__/client.test.ts
// The inventory-ROLE map and the extended-cost arithmetic.
// Nothing here touches a database, the org cache or the logger.

import { describe, expect, it } from 'vitest'
import { ACCOUNT_ROLES } from '../../../accounting/ledger/client'
import {
  computeExtendedCost,
  DEFAULT_RECEIPT_INVENTORY_ROLE,
  INVENTORY_ROLE_BY_PART_KIND,
  resolveInventoryRoleForPartKind,
} from '../client'

describe('resolveInventoryRoleForPartKind', () => {
  // 🛑 These are ROLES, not codes (decision `G8`). The map returned '1310' /
  // '1330' until the chart of accounts became an org-editable default under
  // `G7`; a number frozen onto an append-only movement is silently
  // reinterpreted the day the org renumbers, and the posting still balances so
  // nothing downstream can detect it.
  it('puts components and subassemblies in Raw Materials', () => {
    expect(resolveInventoryRoleForPartKind('component')).toBe('inventory_raw_materials')
    expect(resolveInventoryRoleForPartKind('subassembly')).toBe('inventory_raw_materials')
  })

  it('puts finished goods in Finished Goods', () => {
    expect(resolveInventoryRoleForPartKind('finished_good')).toBe('inventory_finished_goods')
  })

  it('reads NULL as component, the conservative default', () => {
    expect(resolveInventoryRoleForPartKind(null)).toBe('inventory_raw_materials')
    expect(resolveInventoryRoleForPartKind(undefined)).toBe('inventory_raw_materials')
    expect(resolveInventoryRoleForPartKind('')).toBe('inventory_raw_materials')
  })

  it('falls back rather than throwing on an unrecognised kind', () => {
    // A receipt is not the place to discover a fourth part kind: a movement
    // stamped raw materials is correctable, a receipt that failed to write is a
    // pallet nobody counted.
    expect(resolveInventoryRoleForPartKind('work_in_process')).toBe(DEFAULT_RECEIPT_INVENTORY_ROLE)
  })

  it('never resolves to work in process — receiving does not produce WIP', () => {
    expect(Object.values(INVENTORY_ROLE_BY_PART_KIND)).not.toContain('inventory_wip')
  })

  // Every value has to be a role the posting builders actually emit, or
  // `buildReceiptEntry` debits an account the resolver cannot find and the
  // entry fails closed at the worst possible moment.
  it('emits only roles from the closed ACCOUNT_ROLES vocabulary', () => {
    const roles = new Set<string>(Object.values(ACCOUNT_ROLES))
    for (const role of Object.values(INVENTORY_ROLE_BY_PART_KIND)) {
      expect(roles.has(role), role).toBe(true)
    }
    expect(roles.has(DEFAULT_RECEIPT_INVENTORY_ROLE)).toBe(true)
  })

  it('exposes a frozen map so a caller cannot rewrite the mapping', () => {
    expect(Object.isFrozen(INVENTORY_ROLE_BY_PART_KIND)).toBe(true)
  })
})

describe('computeExtendedCost', () => {
  it('multiplies before rounding, not after', () => {
    // Rounding the unit first and multiplying would give 10000 * 45 = 450000.
    // Multiplying first gives round(444.5 * 10000) = 4445000, a $50 difference
    // on one line against the vendor's invoice.
    expect(computeExtendedCost(444.5, 10000)).toBe(4445000)
  })

  it('is signed like the quantity so the subledger sums to the balance', () => {
    expect(computeExtendedCost(4400, 10)).toBe(44000)
    expect(computeExtendedCost(4400, -10)).toBe(-44000)
  })

  it('is zero for a zero quantity', () => {
    expect(computeExtendedCost(4400, 0)).toBe(0)
  })
})
