// packages/lib/src/inventory/builds/__tests__/movement-account-drift-plan.test.ts

import { describe, expect, it } from 'vitest'
import {
  type DriftedMovement,
  expectedInventoryRole,
  planPartAccountDrift,
} from '../movement-account-drift-plan'

const RM = 'inventory_raw_materials'
const FG = 'inventory_finished_goods'

function movement(overrides: Partial<DriftedMovement> & { id: string }): DriftedMovement {
  return { role: FG, extendedCostMinor: -100, posted: false, ...overrides }
}

describe('expectedInventoryRole', () => {
  it('maps kinds to roles, null to raw materials, and a service to nothing', () => {
    expect(expectedInventoryRole('component')).toBe(RM)
    expect(expectedInventoryRole('subassembly')).toBe(RM)
    expect(expectedInventoryRole('finished_good')).toBe(FG)
    expect(expectedInventoryRole(null)).toBe(RM)
    expect(expectedInventoryRole('service')).toBeNull()
  })
})

describe('planPartAccountDrift', () => {
  it('restamps unposted rows by their current role and posts nothing', () => {
    const plan = planPartAccountDrift({
      expectedRole: RM,
      movements: [
        movement({ id: 'a' }),
        movement({ id: 'b', extendedCostMinor: null }),
        movement({ id: 'c', role: RM }),
      ],
    })
    expect(plan.restamps).toEqual([{ fromRole: FG, movementIds: ['a', 'b'] }])
    expect(plan.unpostedCount).toBe(2)
    expect(plan.postedCount).toBe(0)
    expect(plan.correction).toEqual([])
    expect(plan.fromRoles).toEqual([FG])
  })

  it('moves the posted value from the old role to the new one and leaves those rows alone', () => {
    const plan = planPartAccountDrift({
      expectedRole: RM,
      movements: [
        movement({ id: 'a', posted: true, extendedCostMinor: -250 }),
        movement({ id: 'b', posted: true, extendedCostMinor: 1000 }),
        movement({ id: 'c' }),
      ],
    })
    expect(plan.restamps).toEqual([{ fromRole: FG, movementIds: ['c'] }])
    expect(plan.postedCount).toBe(2)
    // FG holds +750 of this part; credit it and debit RM.
    expect(plan.correction).toEqual([
      { role: FG, amountMinor: -750 },
      { role: RM, amountMinor: 750 },
    ])
  })

  it('nets earlier fixes, so a re-run posts nothing', () => {
    const plan = planPartAccountDrift({
      expectedRole: RM,
      movements: [movement({ id: 'a', posted: true, extendedCostMinor: 750 })],
      fixedByRole: new Map([
        [FG, -750],
        [RM, 750],
      ]),
    })
    expect(plan.correction).toEqual([])
    expect(plan.postedCount).toBe(0)
  })

  it('unwinds an earlier fix when the kind is changed back', () => {
    // Stamped FG, fixed to RM, now Finished Good again: the rows are no longer drifted.
    const plan = planPartAccountDrift({
      expectedRole: FG,
      movements: [],
      fixedByRole: new Map([
        [FG, -750],
        [RM, 750],
      ]),
    })
    expect(plan.correction).toEqual([
      { role: RM, amountMinor: -750 },
      { role: FG, amountMinor: 750 },
    ])
  })

  it('posts nothing when the posted rows carry no value', () => {
    const plan = planPartAccountDrift({
      expectedRole: RM,
      movements: [movement({ id: 'a', posted: true, extendedCostMinor: 0 })],
    })
    expect(plan.correction).toEqual([])
    expect(plan.postedCount).toBe(0)
  })
})
