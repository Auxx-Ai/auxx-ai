// packages/lib/src/inventory/costing/__tests__/cost-reads.int.test.ts
// The per-part and per-fulfillment-line cost averages over real `StockMovement` rows (brief 50 §3.4, §3.5).
// Run: npx vitest run --config vitest.integration.config.ts src/inventory/costing/__tests__/cost-reads.int.test.ts

import type { Database } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { insertMovements, seedMovementOrg } from '../../movements/__tests__/support/movement-table'
import { readFulfillmentLineRelievedAverages, readPartLedgerAverages } from '../cost-reads'

const db = () => getTestDb() as unknown as Database

let organizationId: string
let partA: string
let partB: string
let lineA: string
let lineB: string

const priced = (unitCostMinor: number, quantity: number) => ({
  unitCostMinor,
  extendedCostMinor: unitCostMinor * quantity,
  costBasis: 'standard' as const,
})

beforeEach(async () => {
  const org = await seedMovementOrg(4)
  organizationId = org.organizationId
  ;[partA, partB, lineA, lineB] = org.ids as [string, string, string, string]
})

describe('readPartLedgerAverages', () => {
  it('excludes an adjustSubparts row from both sums and averages the rest', async () => {
    await insertMovements(organizationId, [
      { partId: partA, type: 'receive', quantity: 10, ...priced(4_000, 10) },
      { partId: partA, type: 'sale', quantity: -4, ...priced(4_000, -4) },
      { partId: partA, type: 'adjust', quantity: 500, adjustSubparts: true, ...priced(1, 500) },
    ])
    const result = await readPartLedgerAverages(db(), {
      organizationId,
      partInstanceIds: [partA, partA, partB],
    })
    const map = result._unsafeUnwrap()
    expect(map.get(partA)).toEqual({
      partInstanceId: partA,
      valueMinor: 24_000,
      quantity: 6,
      unitCostMinor: 4_000,
    })
    // No movements: absent, not a zero row.
    expect(map.has(partB)).toBe(false)
  })

  it('counts a pending row in the quantity with no value', async () => {
    await insertMovements(organizationId, [
      { partId: partA, type: 'receive', quantity: 10, ...priced(4_000, 10) },
      { partId: partA, type: 'sale', quantity: -4, costBasis: 'pending' },
    ])
    const map = (
      await readPartLedgerAverages(db(), { organizationId, partInstanceIds: [partA] })
    )._unsafeUnwrap()
    expect(map.get(partA)).toMatchObject({ quantity: 6, valueMinor: 40_000 })
  })

  it('returns an empty map for no ids', async () => {
    const map = (
      await readPartLedgerAverages(db(), { organizationId, partInstanceIds: [] })
    )._unsafeUnwrap()
    expect(map.size).toBe(0)
  })
})

describe('readFulfillmentLineRelievedAverages', () => {
  it('counts only priced sale rows, never a return_in reversal or another type', async () => {
    const [sale] = await insertMovements(organizationId, [
      { partId: partA, type: 'sale', quantity: -5, fulfillmentLineId: lineA, ...priced(4_000, -5) },
      { partId: partA, type: 'sale', quantity: -3, fulfillmentLineId: lineA, costBasis: 'pending' },
      {
        partId: partA,
        type: 'build_consume',
        quantity: -100,
        fulfillmentLineId: lineA,
        ...priced(5_000, -100),
      },
      { partId: partA, type: 'sale', quantity: -2, fulfillmentLineId: lineB, costBasis: 'pending' },
    ])
    await insertMovements(organizationId, [
      {
        partId: partA,
        type: 'return_in',
        quantity: 5,
        fulfillmentLineId: lineA,
        reversesMovementId: sale,
        ...priced(4_000, 5),
      },
    ])
    const map = (
      await readFulfillmentLineRelievedAverages(db(), {
        organizationId,
        fulfillmentLineIds: [lineA, lineB],
      })
    )._unsafeUnwrap()
    expect(map.get(lineA)).toEqual({
      fulfillmentLineId: lineA,
      relievedQuantity: 5,
      relievedValueMinor: 20_000,
      unitCostMinor: 4_000,
    })
    expect(map.has(lineB)).toBe(false)
  })

  it('a fully un-relieved line nets to a plain 0, not -0, with no unit cost', async () => {
    await insertMovements(organizationId, [
      { partId: partA, type: 'sale', quantity: -5, fulfillmentLineId: lineA, ...priced(4_000, -5) },
      { partId: partA, type: 'sale', quantity: 5, fulfillmentLineId: lineA, ...priced(4_000, 5) },
    ])
    const entry = (
      await readFulfillmentLineRelievedAverages(db(), {
        organizationId,
        fulfillmentLineIds: [lineA],
      })
    )
      ._unsafeUnwrap()
      .get(lineA)
    expect(entry).toEqual({
      fulfillmentLineId: lineA,
      relievedQuantity: 0,
      relievedValueMinor: 0,
      unitCostMinor: null,
    })
    expect(Object.is(entry?.relievedQuantity, -0)).toBe(false)
    expect(Object.is(entry?.relievedValueMinor, -0)).toBe(false)
  })
})
