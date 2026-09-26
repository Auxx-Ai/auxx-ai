// packages/lib/src/inventory/costing/__tests__/revalue.int.test.ts
//
// Revaluation-shaped movements store the same rows through the batched writer as through the
// per-row CRUD writer (plans/mrp/12-slice-batched-backflush.md §3, 12b).

import { type Database, schema } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { getOrgCache } from '../../../cache'
import { StockMovementCostBasis, StockMovementType } from '../../../resources/registry/enum-values'
import { seedBuildOrg } from '../../builds/__tests__/support/build-fixture'
import {
  DEFAULT_RECEIPT_INVENTORY_ROLE,
  type StockMovementInput,
  type StockMovementsCtx,
  writeStockMovements,
  writeStockMovementsBatch,
} from '../../movements'
import { revalueWriteSession } from '../revalue'

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

/** Instances, values and facts of `ids`, ids and times stripped, ids renamed by position. */
async function snapshot(ids: string[]): Promise<string> {
  const instances = await db()
    .select({
      id: schema.EntityInstance.id,
      displayName: schema.EntityInstance.displayName,
      secondaryDisplayValue: schema.EntityInstance.secondaryDisplayValue,
      searchText: schema.EntityInstance.searchText,
      createdById: schema.EntityInstance.createdById,
      avatarUrl: schema.EntityInstance.avatarUrl,
      archivedAt: schema.EntityInstance.archivedAt,
    })
    .from(schema.EntityInstance)
    .where(inArray(schema.EntityInstance.id, ids))
  const values = await db()
    .select()
    .from(schema.FieldValue)
    .where(inArray(schema.FieldValue.entityId, ids))
    .orderBy(asc(schema.FieldValue.fieldId), asc(schema.FieldValue.sortKey))
  const facts = await db()
    .select()
    .from(schema.InventoryMovementFact)
    .where(inArray(schema.InventoryMovementFact.id, ids))

  const at = (id: string) => ids.indexOf(id)
  let text = JSON.stringify({
    instances: [...instances]
      .sort((a, b) => at(a.id) - at(b.id))
      .map(({ id: _i, ...rest }) => rest),
    values: [...values]
      .sort((a, b) => at(a.entityId) - at(b.entityId))
      .map(({ id: _i, createdAt: _c, updatedAt: _u, ...rest }) => rest),
    facts: [...facts].sort((a, b) => at(a.id) - at(b.id)).map(({ createdAt: _c, ...rest }) => rest),
  })
  ids.forEach((id, index) => {
    text = text.replaceAll(id, `MV${index}`)
  })
  return text
}

describe('revaluation movements through the batched writer', () => {
  it('store what the per-row writer stores, extended cost override included', async () => {
    const f = await seedBuildOrg({ components: 2 })
    const partIds = [f.producedPartId, ...f.componentPartIds]
    const occurredAt = new Date('2026-03-15T12:00:00.000Z')
    const inputs: StockMovementInput[] = partIds.map((partInstanceId, i) => ({
      partInstanceId,
      type: StockMovementType.REVALUE,
      quantity: 0,
      unitCost: i === 1 ? -40 : 125,
      extendedCost: i === 1 ? -400 : 1250 * (i + 1),
      costBasis: StockMovementCostBasis.STANDARD,
      glAccount: DEFAULT_RECEIPT_INVENTORY_ROLE,
      occurredAt,
      reason: 'Standard cost roll',
      reference: 'ROLL-1',
    }))

    const write = async (batched: boolean) => {
      const ids = await db().transaction(async (tx) => {
        const ctx: StockMovementsCtx = {
          db: tx as unknown as Database,
          organizationId: f.organizationId,
          userId: f.userId,
          movementDefId: f.movementDefId,
          partDefId: f.partDefId,
          lane: { kind: 'quiet', session: revalueWriteSession() },
        }
        const written = batched
          ? await writeStockMovementsBatch(ctx, inputs)
          : await writeStockMovements(ctx, inputs)
        if (written.isErr()) throw written.error
        expect(written.value.records.map((record) => record.extendedCost)).toEqual(
          inputs.map((input) => input.extendedCost)
        )
        return written.value.records.map((record) => record.movementId)
      })
      return ids
    }

    const perRow = await write(false)
    const batched = await write(true)
    expect(await snapshot(batched)).toEqual(await snapshot(perRow))

    const fields = await getOrgCache()
      .from(f.organizationId, 'customFields')
      .bySystemAttributes(['stock_movement_extended_cost'] as never)
    const extendedField = (fields as Record<string, { id: string } | null>)
      .stock_movement_extended_cost!
    const stored = await db()
      .select({ entityId: schema.FieldValue.entityId, value: schema.FieldValue.valueNumber })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.fieldId, extendedField.id),
          inArray(schema.FieldValue.entityId, batched)
        )
      )
    expect(batched.map((id) => Number(stored.find((row) => row.entityId === id)?.value))).toEqual(
      inputs.map((input) => input.extendedCost)
    )
  })
})
