// packages/lib/src/accounting/ledger/builders/__tests__/inventory-movement.test.ts
//
// One entry per inventory document, per document kind. Every case asserts the
// SIDE as well as the amount: an entry with the right numbers on the wrong sides
// balances perfectly and is undetectable downstream.

import { describe, expect, it } from 'vitest'
import type { BuiltEntry } from '../../types'
import { ACCOUNT_ROLES } from '../entry'
import { buildInventoryMovementEntry, type InventoryMovementLine } from '../inventory-movement'

const RAW = ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS
const FG = ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS

function movement(
  id: string,
  extendedCostMinor: number,
  glAccountRole: string = RAW
): InventoryMovementLine {
  return { id, extendedCostMinor, glAccountRole }
}

/** `role -> signed minor units`, positive for a debit. */
function legs(entry: BuiltEntry): Record<string, number> {
  const byRole: Record<string, number> = {}
  for (const line of entry.lines) {
    const role = (line as { accountRole?: string }).accountRole ?? ''
    byRole[role] = (byRole[role] ?? 0) + (line.direction === 'debit' ? line.amount : -line.amount)
  }
  return byRole
}

const BASE = { documentKind: 'stock_movement', documentId: 'doc_1', txnDate: '2026-08-18' } as const

describe('a sale', () => {
  it('debits cost of goods sold and credits the inventory the movements left', () => {
    const built = buildInventoryMovementEntry({
      ...BASE,
      kind: 'sale',
      movements: [movement('sm_1', -12_000, FG), movement('sm_2', -3_000, FG)],
    })!

    expect(legs(built.entry)).toEqual({
      [ACCOUNT_ROLES.COGS_PRODUCT_COST]: 15_000,
      [FG]: -15_000,
    })
    expect(built.memberMovementIds).toEqual(['sm_1', 'sm_2'])
  })

  it('splits the credit by the frozen account, never by one default', () => {
    // A shipment of a finished good and a loose component relieves two accounts,
    // and collapsing them would overstate one and understate the other forever.
    const built = buildInventoryMovementEntry({
      ...BASE,
      kind: 'sale',
      movements: [movement('sm_1', -10_000, FG), movement('sm_2', -2_500, RAW)],
    })!

    expect(legs(built.entry)).toEqual({
      [ACCOUNT_ROLES.COGS_PRODUCT_COST]: 12_500,
      [FG]: -10_000,
      [RAW]: -2_500,
    })
  })

  it('flips both sides on an over-relief correction', () => {
    const built = buildInventoryMovementEntry({
      ...BASE,
      kind: 'sale',
      movements: [movement('sm_1', 4_000, FG)],
    })!

    expect(legs(built.entry)).toEqual({
      [ACCOUNT_ROLES.COGS_PRODUCT_COST]: -4_000,
      [FG]: 4_000,
    })
  })
})

describe('a receipt', () => {
  it('debits inventory and credits goods received not invoiced', () => {
    const built = buildInventoryMovementEntry({
      ...BASE,
      kind: 'receive',
      movements: [movement('sm_1', 50_000)],
    })!

    expect(legs(built.entry)).toEqual({ [RAW]: 50_000, [ACCOUNT_ROLES.GRNI]: -50_000 })
  })
})

describe('an adjustment and a scrap', () => {
  it('books a found unit against count variance', () => {
    const built = buildInventoryMovementEntry({
      ...BASE,
      kind: 'adjust',
      movements: [movement('sm_1', 2_500)],
    })!

    expect(legs(built.entry)).toEqual({
      [RAW]: 2_500,
      [ACCOUNT_ROLES.INVENTORY_COUNT_VARIANCE]: -2_500,
    })
  })

  it('books shrinkage the other way round, on the same account', () => {
    const built = buildInventoryMovementEntry({
      ...BASE,
      kind: 'adjust',
      movements: [movement('sm_1', -2_500)],
    })!

    expect(legs(built.entry)).toEqual({
      [RAW]: -2_500,
      [ACCOUNT_ROLES.INVENTORY_COUNT_VARIANCE]: 2_500,
    })
  })

  it('books a scrap as a removal against count variance', () => {
    const built = buildInventoryMovementEntry({
      ...BASE,
      kind: 'scrap',
      movements: [movement('sm_1', -900, FG)],
    })!

    expect(legs(built.entry)).toEqual({
      [FG]: -900,
      [ACCOUNT_ROLES.INVENTORY_COUNT_VARIANCE]: 900,
    })
  })
})

describe('a build', () => {
  it('moves value between the inventory accounts and absorbs labour and overhead', () => {
    const built = buildInventoryMovementEntry({
      ...BASE,
      kind: 'build',
      movements: [movement('sm_c', -40_000, RAW), movement('sm_p', 52_000, FG)],
      absorbed: { laborMinor: 8_000, overheadMinor: 4_000 },
    })!

    expect(legs(built.entry)).toEqual({
      [RAW]: -40_000,
      [FG]: 52_000,
      [ACCOUNT_ROLES.PAYROLL_CLEARING]: -8_000,
      [ACCOUNT_ROLES.APPLIED_OVERHEAD]: -4_000,
    })
  })

  it('lands the residual in purchase price variance, on the side its sign says', () => {
    // Produced value below what the run consumed and absorbed is unfavourable:
    // a debit. Reading it as a credit would report a loss as a gain.
    const built = buildInventoryMovementEntry({
      ...BASE,
      kind: 'build',
      movements: [movement('sm_c', -40_000, RAW), movement('sm_p', 50_000, FG)],
      absorbed: { laborMinor: 8_000, overheadMinor: 4_000 },
    })!

    expect(legs(built.entry)[ACCOUNT_ROLES.PPV]).toBe(2_000)
  })

  it('emits no absorption legs at all when a run absorbed nothing', () => {
    const built = buildInventoryMovementEntry({
      ...BASE,
      kind: 'build',
      movements: [movement('sm_c', -40_000, RAW), movement('sm_p', 40_000, FG)],
    })!

    expect(legs(built.entry)).toEqual({ [RAW]: -40_000, [FG]: 40_000 })
  })
})

describe('a return and the opening run', () => {
  it('puts a restocked unit back and un-books what the sale charged to COGS', () => {
    const built = buildInventoryMovementEntry({
      ...BASE,
      kind: 'return',
      movements: [movement('sm_1', 7_500, FG)],
    })!

    expect(legs(built.entry)).toEqual({
      [FG]: 7_500,
      [ACCOUNT_ROLES.COGS_PRODUCT_COST]: -7_500,
    })
  })

  it('raises opening stock against opening balance equity', () => {
    const built = buildInventoryMovementEntry({
      ...BASE,
      kind: 'opening',
      movements: [movement('sm_1', 100_000, RAW), movement('sm_2', 25_000, FG)],
    })!

    expect(legs(built.entry)).toEqual({
      [RAW]: 100_000,
      [FG]: 25_000,
      [ACCOUNT_ROLES.EQUITY_OPENING_BALANCE]: -125_000,
    })
  })
})

describe('what it refuses and what it declines to build', () => {
  it('builds NOTHING for a document that moved no money', () => {
    expect(
      buildInventoryMovementEntry({ ...BASE, kind: 'sale', movements: [movement('sm_1', 0)] })
    ).toBeNull()
    expect(buildInventoryMovementEntry({ ...BASE, kind: 'sale', movements: [] })).toBeNull()
  })

  it('builds nothing for a build whose legs net exactly, with no absorption', () => {
    // Not a refusal: a consume and a produce of equal value is an ordinary run,
    // and `buildEntry` would throw on the two zero legs it would otherwise make.
    expect(
      buildInventoryMovementEntry({
        ...BASE,
        kind: 'build',
        movements: [movement('sm_c', -1_000, RAW), movement('sm_p', 1_000, RAW)],
      })
    ).toBeNull()
  })

  it('refuses a movement with no frozen inventory account, naming it', () => {
    expect(() =>
      buildInventoryMovementEntry({
        ...BASE,
        kind: 'sale',
        movements: [{ id: 'sm_9', extendedCostMinor: -100, glAccountRole: '' }],
      })
    ).toThrow(/sm_9/)
  })

  it('refuses a fractional minor unit', () => {
    expect(() =>
      buildInventoryMovementEntry({ ...BASE, kind: 'sale', movements: [movement('sm_1', -100.5)] })
    ).toThrow(/integer number of minor units/)
  })
})

describe('the claim identity', () => {
  it('keys on the DOCUMENT, so one document holds one live entry', () => {
    const built = buildInventoryMovementEntry({
      ...BASE,
      documentId: 'ful_7',
      kind: 'sale',
      movements: [movement('sm_1', -100, FG)],
    })!

    expect(built.entry.periodKey).toBe('ful_7')
    expect(built.entry.postingType).toBe('inventory_movement')
    expect(built.entry.txnDate).toBe('2026-08-18')
  })

  it('names every movement as a member, in the order they were written', () => {
    const built = buildInventoryMovementEntry({
      ...BASE,
      kind: 'sale',
      movements: [movement('sm_3', -1, FG), movement('sm_1', -2, FG), movement('sm_2', -3, FG)],
    })!

    expect(built.memberMovementIds).toEqual(['sm_3', 'sm_1', 'sm_2'])
  })
})
