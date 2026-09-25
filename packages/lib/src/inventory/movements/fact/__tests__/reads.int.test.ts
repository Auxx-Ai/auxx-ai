// packages/lib/src/inventory/movements/fact/__tests__/reads.int.test.ts
// The mirror's SQL over a seeded ledger (plans/mrp/02-data-structures.md §6.1, §6.2, §6.5, §7a).
// Run: npx vitest run --config vitest.integration.config.ts src/inventory/movements/fact

import type { Database } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConsumptionClass } from '../classify'
import {
  readDailySeries,
  readReceiptsForPoLines,
  readUsageBuckets,
  readWhereUsedShares,
} from '../reads'
import { insertMovementFacts } from '../writes'
import { insertMovementInstances, seedMovementDef } from './support/movement-instances'

const db = () => getTestDb() as unknown as Database
const ZONE = 'America/Los_Angeles'

let organizationId: string
let movementDefId: string

async function fact(input: {
  partId: string
  type: string
  quantity: number
  at: string
  consumptionClass: ConsumptionClass
  buildId?: string
  purchaseOrderLineId?: string
}): Promise<string> {
  const [id] = await insertMovementInstances(db(), organizationId, movementDefId)
  if (!id) throw new Error('fixture: no movement instance')
  await insertMovementFacts(db(), organizationId, [
    {
      id,
      partId: input.partId,
      type: input.type,
      quantity: input.quantity,
      occurredAt: new Date(input.at),
      createdAt: new Date(input.at),
      consumptionClass: input.consumptionClass,
      buildId: input.buildId ?? null,
      purchaseOrderLineId: input.purchaseOrderLineId ?? null,
    },
  ])
  return id
}

beforeEach(async () => {
  const org = await createTestOrganization()
  organizationId = org.id
  movementDefId = await seedMovementDef(db(), organizationId)
})

describe('readDailySeries', () => {
  it('replays a dense series with the opening balance, bucketed by book day', async () => {
    await fact({
      partId: 'p1',
      type: 'initial',
      quantity: 10,
      at: '2026-08-20T12:00:00Z',
      consumptionClass: 'supply',
    })
    // 05:00Z on Sep 2 is 22:00 on Sep 1 in Los Angeles.
    await fact({
      partId: 'p1',
      type: 'sale',
      quantity: -3,
      at: '2026-09-02T05:00:00Z',
      consumptionClass: 'consumption',
    })
    await fact({
      partId: 'p1',
      type: 'scrap',
      quantity: -1,
      at: '2026-09-03T18:00:00Z',
      consumptionClass: 'scrap',
    })

    const result = await readDailySeries(db(), organizationId, {
      partIds: ['p1', 'p2'],
      from: '2026-09-01',
      to: '2026-09-03',
      zone: ZONE,
    })
    if (result.isErr()) throw result.error
    const p1 = result.value.filter((row) => row.partId === 'p1')
    expect(p1).toEqual([
      { partId: 'p1', day: '2026-09-01', consumed: 3, scrapped: 0, net: -3, onHandEod: 7 },
      { partId: 'p1', day: '2026-09-02', consumed: 0, scrapped: 0, net: 0, onHandEod: 7 },
      { partId: 'p1', day: '2026-09-03', consumed: 0, scrapped: 1, net: -1, onHandEod: 6 },
    ])
    const p2 = result.value.filter((row) => row.partId === 'p2')
    expect(p2).toHaveLength(3)
    expect(p2.every((row) => row.onHandEod === 0 && row.consumed === 0)).toBe(true)
  })

  it('nets a reversal against its original class', async () => {
    await fact({
      partId: 'p1',
      type: 'sale',
      quantity: -4,
      at: '2026-09-01T18:00:00Z',
      consumptionClass: 'consumption',
    })
    await fact({
      partId: 'p1',
      type: 'return_in',
      quantity: 4,
      at: '2026-09-01T19:00:00Z',
      consumptionClass: 'consumption',
    })
    const result = await readDailySeries(db(), organizationId, {
      partIds: ['p1'],
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
    await fact({
      partId: 'p1',
      type: 'receive',
      quantity: 5,
      at: '2026-07-01T18:00:00Z',
      consumptionClass: 'supply',
    })
    await fact({
      partId: 'p1',
      type: 'sale',
      quantity: -5,
      at: '2026-07-29T18:00:00Z',
      consumptionClass: 'consumption',
    })
    const result = await readUsageBuckets(db(), organizationId, {
      partIds: ['p1'],
      from: '2026-07-01',
      to: '2026-08-31',
      zone: ZONE,
      grain: 'month',
    })
    if (result.isErr()) throw result.error
    expect(result.value).toEqual([
      // Jul 29 itself consumed, so only Jul 30 and 31 are stockout days.
      { partId: 'p1', month: '2026-07', consumed: 5, scrapped: 0, stockoutDays: 2 },
      { partId: 'p1', month: '2026-08', consumed: 0, scrapped: 0, stockoutDays: 31 },
    ])
  })
})

describe('readReceiptsForPoLines', () => {
  it('returns only receive rows on the asked lines, oldest first', async () => {
    const late = await fact({
      partId: 'p1',
      type: 'receive',
      quantity: 6,
      at: '2026-09-10T18:00:00Z',
      consumptionClass: 'supply',
      purchaseOrderLineId: 'pol_1',
    })
    const early = await fact({
      partId: 'p1',
      type: 'receive',
      quantity: 4,
      at: '2026-09-05T18:00:00Z',
      consumptionClass: 'supply',
      purchaseOrderLineId: 'pol_1',
    })
    await fact({
      partId: 'p1',
      type: 'return_out',
      quantity: -4,
      at: '2026-09-06T18:00:00Z',
      consumptionClass: 'supply',
      purchaseOrderLineId: 'pol_1',
    })
    await fact({
      partId: 'p1',
      type: 'receive',
      quantity: 1,
      at: '2026-09-01T18:00:00Z',
      consumptionClass: 'supply',
      purchaseOrderLineId: 'pol_other',
    })
    const result = await readReceiptsForPoLines(db(), organizationId, ['pol_1'])
    if (result.isErr()) throw result.error
    expect(result.value.map((row) => [row.movementId, row.quantity])).toEqual([
      [early, 4],
      [late, 6],
    ])
  })
})

describe('readWhereUsedShares', () => {
  it('splits a component across the parts its builds produced', async () => {
    const at = '2026-09-02T18:00:00Z'
    await fact({
      partId: 'lift_a',
      type: 'build_produce',
      quantity: 1,
      at,
      consumptionClass: 'supply',
      buildId: 'b1',
    })
    await fact({
      partId: 'lift_b',
      type: 'build_produce',
      quantity: 1,
      at,
      consumptionClass: 'supply',
      buildId: 'b2',
    })
    await fact({
      partId: 'motor',
      type: 'build_consume',
      quantity: -3,
      at,
      consumptionClass: 'consumption',
      buildId: 'b1',
    })
    await fact({
      partId: 'motor',
      type: 'build_consume',
      quantity: -1,
      at,
      consumptionClass: 'consumption',
      buildId: 'b2',
    })

    const result = await readWhereUsedShares(db(), organizationId, ['motor'], {
      from: '2026-09-01',
      to: '2026-09-30',
      zone: ZONE,
    })
    if (result.isErr()) throw result.error
    expect(result.value).toEqual([
      { componentId: 'motor', producedPartId: 'lift_a', quantity: 3, share: 0.75 },
      { componentId: 'motor', producedPartId: 'lift_b', quantity: 1, share: 0.25 },
    ])
  })
})
