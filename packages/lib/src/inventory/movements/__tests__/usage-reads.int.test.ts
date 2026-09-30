// packages/lib/src/inventory/movements/__tests__/usage-reads.int.test.ts
// The usage SQL over a seeded ledger (plans/mrp/02-data-structures.md §6.1, §6.2, §6.5, §7a).
// Run: npx vitest run --config vitest.integration.config.ts src/inventory/movements/__tests__/usage-reads

import type { Database } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  readDailyActivity,
  readDailySeries,
  readReceiptsForPoLines,
  readUsageBuckets,
  readWhereUsedShares,
} from '../usage-reads'
import { insertMovements, type MovementFixtureRow, seedMovementOrg } from './support/movement-table'

const db = () => getTestDb() as unknown as Database
const ZONE = 'America/Los_Angeles'

let organizationId: string
let ids: string[]

/** The seeded instance at `index`, standing in for a part or a PO line. */
const inst = (index: number): string => {
  const id = ids[index]
  if (!id) throw new Error(`fixture: no instance ${index}`)
  return id
}

async function move(row: Omit<MovementFixtureRow, 'occurredAt'> & { at: string }): Promise<string> {
  const { at, ...rest } = row
  const [id] = await insertMovements(organizationId, [{ ...rest, occurredAt: new Date(at) }])
  if (!id) throw new Error('fixture: movement not inserted')
  return id
}

beforeEach(async () => {
  const org = await seedMovementOrg(8)
  organizationId = org.organizationId
  ids = org.ids
})

describe('readDailySeries', () => {
  it('replays a dense series with the opening balance, bucketed by book day', async () => {
    const [p1, p2] = [inst(0), inst(1)]
    await move({ partId: p1, type: 'initial', quantity: 10, at: '2026-08-20T12:00:00Z' })
    // 05:00Z on Sep 2 is 22:00 on Sep 1 in Los Angeles.
    await move({ partId: p1, type: 'sale', quantity: -3, at: '2026-09-02T05:00:00Z' })
    await move({ partId: p1, type: 'scrap', quantity: -1, at: '2026-09-03T18:00:00Z' })

    const result = await readDailySeries(db(), organizationId, {
      partIds: [p1, p2],
      from: '2026-09-01',
      to: '2026-09-03',
      zone: ZONE,
    })
    if (result.isErr()) throw result.error
    expect(result.value.filter((row) => row.partId === p1)).toEqual([
      { partId: p1, day: '2026-09-01', consumed: 3, scrapped: 0, net: -3, onHandEod: 7 },
      { partId: p1, day: '2026-09-02', consumed: 0, scrapped: 0, net: 0, onHandEod: 7 },
      { partId: p1, day: '2026-09-03', consumed: 0, scrapped: 1, net: -1, onHandEod: 6 },
    ])
    const rows2 = result.value.filter((row) => row.partId === p2)
    expect(rows2).toHaveLength(3)
    expect(rows2.every((row) => row.onHandEod === 0 && row.consumed === 0)).toBe(true)
  })

  it('dates a row without occurredAt by its createdAt', async () => {
    const p1 = inst(0)
    await insertMovements(organizationId, [
      { partId: p1, type: 'sale', quantity: -2, createdAt: new Date('2026-09-01T18:00:00Z') },
    ])
    const result = await readDailySeries(db(), organizationId, {
      partIds: [p1],
      from: '2026-09-01',
      to: '2026-09-01',
      zone: ZONE,
    })
    if (result.isErr()) throw result.error
    expect(result.value[0]).toMatchObject({ consumed: 2, net: -2, onHandEod: -2 })
  })

  it('nets a reversal against its original class', async () => {
    const p1 = inst(0)
    const sale = await move({ partId: p1, type: 'sale', quantity: -4, at: '2026-09-01T18:00:00Z' })
    await move({
      partId: p1,
      type: 'return_in',
      quantity: 4,
      at: '2026-09-01T19:00:00Z',
      reversesMovementId: sale,
    })
    const result = await readDailySeries(db(), organizationId, {
      partIds: [p1],
      from: '2026-09-01',
      to: '2026-09-01',
      zone: ZONE,
    })
    if (result.isErr()) throw result.error
    expect(result.value[0]).toMatchObject({ consumed: 0, net: 0, onHandEod: 0 })
  })
})

describe('readUsageBuckets', () => {
  it('sums a month and counts its stockout days', async () => {
    const p1 = inst(0)
    await move({ partId: p1, type: 'receive', quantity: 5, at: '2026-07-01T18:00:00Z' })
    await move({ partId: p1, type: 'sale', quantity: -5, at: '2026-07-29T18:00:00Z' })
    const result = await readUsageBuckets(db(), organizationId, {
      partIds: [p1],
      from: '2026-07-01',
      to: '2026-08-31',
      zone: ZONE,
      grain: 'month',
    })
    if (result.isErr()) throw result.error
    expect(result.value).toEqual([
      // Jul 29 itself consumed, so only Jul 30 and 31 are stockout days.
      { partId: p1, month: '2026-07', consumed: 5, scrapped: 0, stockoutDays: 2 },
      { partId: p1, month: '2026-08', consumed: 0, scrapped: 0, stockoutDays: 31 },
    ])
  })

  it('does not count days below zero as stockouts', async () => {
    const p1 = inst(0)
    await move({ partId: p1, type: 'sale', quantity: -5, at: '2026-07-01T18:00:00Z' })
    const result = await readUsageBuckets(db(), organizationId, {
      partIds: [p1],
      from: '2026-07-01',
      to: '2026-07-31',
      zone: ZONE,
      grain: 'month',
    })
    if (result.isErr()) throw result.error
    expect(result.value).toEqual([
      { partId: p1, month: '2026-07', consumed: 5, scrapped: 0, stockoutDays: 0 },
    ])
  })
})

describe('readReceiptsForPoLines', () => {
  it('returns only receive rows on the asked lines, oldest first', async () => {
    const [p1, pol1, polOther] = [inst(0), inst(5), inst(6)]
    const late = await move({
      partId: p1,
      type: 'receive',
      quantity: 6,
      at: '2026-09-10T18:00:00Z',
      purchaseOrderLineId: pol1,
    })
    const early = await move({
      partId: p1,
      type: 'receive',
      quantity: 4,
      at: '2026-09-05T18:00:00Z',
      purchaseOrderLineId: pol1,
    })
    await move({
      partId: p1,
      type: 'return_out',
      quantity: -4,
      at: '2026-09-06T18:00:00Z',
      purchaseOrderLineId: pol1,
    })
    await move({
      partId: p1,
      type: 'receive',
      quantity: 1,
      at: '2026-09-01T18:00:00Z',
      purchaseOrderLineId: polOther,
    })
    const result = await readReceiptsForPoLines(db(), organizationId, [pol1])
    if (result.isErr()) throw result.error
    expect(result.value.map((row) => [row.movementId, row.quantity])).toEqual([
      [early, 4],
      [late, 6],
    ])
    expect(result.value[0]?.occurredAt).toEqual(new Date('2026-09-05T18:00:00Z'))
  })
})

describe('readWhereUsedShares', () => {
  it('splits a component across the parts its builds produced', async () => {
    const [liftA, liftB, motor] = [inst(2), inst(3), inst(4)]
    const at = '2026-09-02T18:00:00Z'
    await move({ partId: liftA, type: 'build_produce', quantity: 1, at, buildId: 'b1' })
    await move({ partId: liftB, type: 'build_produce', quantity: 1, at, buildId: 'b2' })
    await move({ partId: motor, type: 'build_consume', quantity: -3, at, buildId: 'b1' })
    await move({ partId: motor, type: 'build_consume', quantity: -1, at, buildId: 'b2' })

    const result = await readWhereUsedShares(db(), organizationId, [motor], {
      from: '2026-09-01',
      to: '2026-09-30',
      zone: ZONE,
    })
    if (result.isErr()) throw result.error
    // Rows come ordered by produced part id, and these ids are random.
    const expected = [
      { componentId: motor, producedPartId: liftA, quantity: 3, share: 0.75 },
      { componentId: motor, producedPartId: liftB, quantity: 1, share: 0.25 },
    ].sort((a, b) => (a.producedPartId < b.producedPartId ? -1 : 1))
    expect(result.value).toEqual(expected)
  })
})

describe('readDailyActivity', () => {
  it('counts sales, produces and consumes, leaving out reversals and exploded children', async () => {
    const [kit, bolt] = [inst(0), inst(1)]
    const at = '2026-09-02T18:00:00Z'
    const sale = await move({ partId: kit, type: 'sale', quantity: -2, at })
    await move({ partId: kit, type: 'ship', quantity: -1, at })
    await move({ partId: kit, type: 'sale', quantity: 2, at, reversesMovementId: sale })
    await move({ partId: bolt, type: 'sale', quantity: -4, at, parentMovementId: sale })
    await move({ partId: kit, type: 'build_produce', quantity: 5, at, buildId: 'b1' })
    await move({ partId: bolt, type: 'build_consume', quantity: -10, at, buildId: 'b1' })

    const result = await readDailyActivity(db(), organizationId, {
      partIds: [kit, bolt],
      from: '2026-09-01',
      to: '2026-09-30',
      zone: ZONE,
    })
    if (result.isErr()) throw result.error
    const byPart = new Map(result.value.map((row) => [row.partId, row]))
    expect(byPart.get(kit)).toMatchObject({
      day: '2026-09-02',
      saleQty: 3,
      saleCount: 2,
      produceQty: 5,
      produceCount: 1,
      consumeCount: 0,
    })
    expect(byPart.get(bolt)).toMatchObject({ saleCount: 0, consumeQty: 10, consumeCount: 1 })
  })
})
