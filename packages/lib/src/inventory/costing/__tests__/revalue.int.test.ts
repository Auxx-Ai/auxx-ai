// packages/lib/src/inventory/costing/__tests__/revalue.int.test.ts
// Revaluation rows land in StockMovement at quantity 0 with the extended cost override (73 §6.2).

import { type Database, schema } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { inArray } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { seedBuildOrg } from '../../builds/__tests__/support/build-fixture'
import { DEFAULT_RECEIPT_INVENTORY_ROLE } from '../../movements'
import { writeRevaluation } from '../revalue'

vi.mock('../../../events/publisher', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publisher: { publish: async () => {}, publishLater: async () => {} },
}))
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../dedup/enqueue-scan')>()),
  enqueueDuplicateScan: async () => {},
}))
vi.mock('../../../realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../realtime')>()),
  getRealtimeService: () => ({ publish: async () => true }),
}))

const db = () => getTestDb() as unknown as Database

describe('writeRevaluation', () => {
  it('writes one quantity-0 row per non-zero line, carrying the extended cost as given', async () => {
    const f = await seedBuildOrg({ components: 2 })
    const partIds = [f.producedPartId, ...f.componentPartIds]
    const occurredAt = new Date('2026-03-15T12:00:00.000Z')
    const lines = partIds.map((partInstanceId, i) => ({
      partInstanceId,
      unitDeltaMinor: i === 1 ? -40 : 125,
      extendedDeltaMinor: i === 1 ? -400 : i === 2 ? 0 : 1250,
      glAccountRole: DEFAULT_RECEIPT_INVENTORY_ROLE,
    }))

    const result = await writeRevaluation(db(), f.organizationId, f.userId, {
      lines,
      occurredAt,
      reason: 'Standard cost roll',
      reference: 'ROLL-1',
    })
    if (result.isErr()) throw result.error
    expect(result.value.postedMinor).toBe(850)
    expect(result.value.movementIds).toHaveLength(2)

    const rows = await db()
      .select()
      .from(schema.StockMovement)
      .where(inArray(schema.StockMovement.id, result.value.movementIds))
    const byPart = new Map(rows.map((row) => [row.partId, row]))
    expect(byPart.get(partIds[0]!)).toMatchObject({
      type: 'revalue',
      quantity: 0,
      unitCostMinor: 125,
      extendedCostMinor: 1250,
      costBasis: 'standard',
      glRole: DEFAULT_RECEIPT_INVENTORY_ROLE,
      reason: 'Standard cost roll',
      reference: 'ROLL-1',
    })
    expect(byPart.get(partIds[1]!)).toMatchObject({ unitCostMinor: -40, extendedCostMinor: -400 })
    // A zero-delta line restates nothing and writes nothing.
    expect(byPart.has(partIds[2]!)).toBe(false)
  })
})
