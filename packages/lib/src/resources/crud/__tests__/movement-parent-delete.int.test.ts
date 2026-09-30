// packages/lib/src/resources/crud/__tests__/movement-parent-delete.int.test.ts
// Deleting a part through the record handler takes its StockMovement rows with it; a settled
// period or a build naming the part still refuses (plans/mrp/20 S9, plans/mrp/23 §4).

import { type Database, schema, type Transaction } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import type { StockMovementInput } from '../../../inventory/movements'
import { settleStockMovements, writeStockMovements } from '../../../inventory/movements'
import { createEntityDefinitions } from '../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../seed/entity-seeder/create-fields'
import { linkDisplayFields } from '../../../seed/entity-seeder/link-display-fields'
import { linkRelationships } from '../../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../../seed/entity-seeder/types'
import { PartKind } from '../../registry/enum-values'
import { toRecordId } from '../../resource-id'
import { UnifiedCrudHandler } from '../unified-handler'

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
const AT = new Date('2026-03-15T12:00:00.000Z')
const GL = 'inventory_raw_materials'

async function seed() {
  const org = await createTestOrganization()
  const user = await createTestUser()
  const organizationId = org.id
  const all = await createEntityDefinitions(db(), organizationId)
  const defs: EntityDefMap = new Map(
    [...all].filter(([kind]) => ['part', 'subpart'].includes(kind))
  )
  const made = await createAllFields(db(), organizationId, defs)
  await linkRelationships(db(), defs, made)
  await linkDisplayFields(db(), defs, made)

  const crud = new UnifiedCrudHandler(organizationId, user.id, db())
  const partDefId = defs.get('part')!.id
  const partIds: string[] = []
  for (const title of ['Mast', 'Pump']) {
    const created = await crud.create(partDefId, {
      part_title: title,
      part_sku: `SKU-${title.toUpperCase()}`,
      part_kind: PartKind.COMPONENT,
    })
    partIds.push(created.instance.id)
  }

  const write = async (inputs: StockMovementInput[]) => {
    const written = await db().transaction(async (tx: Transaction) =>
      writeStockMovements({ db: tx, organizationId, userId: user.id }, inputs)
    )
    await settleStockMovements(organizationId, written._unsafeUnwrap().touched)
  }
  const movementsOf = (partId: string) =>
    db()
      .select({ id: schema.StockMovement.id })
      .from(schema.StockMovement)
      .where(
        and(
          eq(schema.StockMovement.organizationId, organizationId),
          eq(schema.StockMovement.partId, partId)
        )
      )
  return {
    organizationId,
    crud,
    partDefId,
    mast: partIds[0]!,
    pump: partIds[1]!,
    write,
    movementsOf,
  }
}

const move = (partInstanceId: string, over: Partial<StockMovementInput>): StockMovementInput => ({
  partInstanceId,
  type: 'receive',
  quantity: 1,
  unitCost: 100,
  costBasis: 'standard',
  glRole: GL,
  occurredAt: AT,
  ...over,
})

describe('deleting a movement parent', () => {
  it('deletes a part whose movements sit in an open period', async () => {
    const s = await seed()
    await s.write([move(s.pump, { quantity: 5 })])

    await s.crud.delete(toRecordId(s.partDefId, s.pump))

    expect(await s.movementsOf(s.pump)).toEqual([])
    const [part] = await db()
      .select()
      .from(schema.EntityInstance)
      .where(eq(schema.EntityInstance.id, s.pump))
    expect(part).toBeUndefined()
  })

  it('refuses a part whose movements sit in a settled period, through the guard', async () => {
    const s = await seed()
    await s.write([move(s.pump, { quantity: 5 })])
    await db().insert(schema.OrganizationSetting).values({
      organizationId: s.organizationId,
      key: 'accounting.cutoffPeriod',
      value: '2026-03',
      updatedAt: new Date(),
    })

    await expect(s.crud.delete(toRecordId(s.partDefId, s.pump))).rejects.toThrow(
      /reversing an entry/
    )
    expect(await s.movementsOf(s.pump)).toHaveLength(1)
  })

  it('refuses a part a build names, and keeps the part', async () => {
    const s = await seed()
    await db()
      .insert(schema.Build)
      .values({ organizationId: s.organizationId, number: 'B-0001', partId: s.mast })

    await expect(s.crud.delete(toRecordId(s.partDefId, s.mast))).rejects.toThrow(/1 build\b/)
    const [part] = await db()
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .where(eq(schema.EntityInstance.id, s.mast))
    expect(part?.id).toBe(s.mast)
  })
})
