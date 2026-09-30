// packages/lib/src/inventory/movements/__tests__/write-movements.int.test.ts
// The StockMovement seam against a real database: insert, facts, the reversal constraint, and
// the parent delete (plans/mrp/20-stock-movement-table.md §4.2).

import { type Database, schema, type Transaction } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { eq, inArray } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { ConflictError } from '../../../errors'
import { UnifiedCrudHandler } from '../../../resources/crud/unified-handler'
import { PartKind } from '../../../resources/registry/enum-values'
import { createEntityDefinitions } from '../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../seed/entity-seeder/create-fields'
import { linkDisplayFields } from '../../../seed/entity-seeder/link-display-fields'
import { linkRelationships } from '../../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../../seed/entity-seeder/types'
import { deleteMovementsFor } from '../delete-movements'
import { readMovementsByParts } from '../reads'
import type { StockMovementInput } from '../types'
import { writeStockMovements } from '../write-movements'

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

interface Org {
  organizationId: string
  userId: string
  partIds: string[]
  fulfillmentLineId: string
}

async function seedOrg(): Promise<Org> {
  const org = await createTestOrganization()
  const user = await createTestUser()
  await db()
    .update(schema.Organization)
    .set({ systemUserId: user.id })
    .where(eq(schema.Organization.id, org.id))
  const all = await createEntityDefinitions(db(), org.id)
  const defs: EntityDefMap = new Map(
    [...all].filter(([kind]) => ['part', 'subpart', 'fulfillment_line'].includes(kind))
  )
  const made = await createAllFields(db(), org.id, defs)
  await linkRelationships(db(), defs, made)
  await linkDisplayFields(db(), defs, made)

  const crud = new UnifiedCrudHandler(org.id, user.id, db())
  const partIds: string[] = []
  for (const title of ['Mast', 'Pump']) {
    const created = await crud.create(defs.get('part')!.id, {
      part_title: title,
      part_sku: `SKU-${title.toUpperCase()}`,
      part_kind: PartKind.COMPONENT,
    })
    partIds.push(created.instance.id)
  }
  const [line] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: org.id,
      entityDefinitionId: defs.get('fulfillment_line')!.id,
      createdById: user.id,
      updatedAt: new Date(),
    })
    .returning()
  return { organizationId: org.id, userId: user.id, partIds, fulfillmentLineId: line!.id }
}

const AT = new Date('2026-03-15T12:00:00.000Z')
const GL = 'inventory_raw_materials'

async function write(o: Org, inputs: StockMovementInput[]) {
  return db().transaction(async (tx: Transaction) =>
    writeStockMovements({ db: tx, organizationId: o.organizationId, userId: o.userId }, inputs)
  )
}

describe('writeStockMovements', () => {
  it('stores rows, facts and exact money, and reports what it touched', async () => {
    const o = await seedOrg()
    const written = (
      await write(o, [
        {
          partInstanceId: o.partIds[0]!,
          type: 'sale',
          quantity: -2,
          unitCost: null,
          costBasis: 'pending',
          glRole: GL,
          occurredAt: AT,
          links: { fulfillmentLineId: o.fulfillmentLineId },
        },
        {
          partInstanceId: o.partIds[1]!,
          type: 'receive',
          quantity: 3,
          unitCost: 1.594,
          costBasis: 'standard',
          glRole: GL,
          occurredAt: AT,
          accrued: { freightMinor: 120 },
        },
      ])
    )._unsafeUnwrap()

    expect(written.touched).toEqual({
      partIds: o.partIds,
      purchaseOrderLineIds: [],
      fulfillmentLineIds: [o.fulfillmentLineId],
      buildIds: [],
    })
    const rows = await readMovementsByParts(db(), o.organizationId, o.partIds)
    const byId = new Map(rows.map((row) => [row.id, row]))
    const [sale, receipt] = written.records.map((record) => byId.get(record.id)!)
    expect(sale).toMatchObject({
      quantity: -2,
      unitCostMinor: null,
      extendedCostMinor: null,
      consumptionClass: 'consumption',
    })
    expect(receipt).toMatchObject({
      unitCostMinor: 1.594,
      extendedCostMinor: 5,
      freightAccruedMinor: 120,
      effectiveAt: AT,
      consumptionClass: 'supply',
    })
    const facts = await db()
      .select()
      .from(schema.InventoryMovementFact)
      .where(inArray(schema.InventoryMovementFact.id, [sale!.id, receipt!.id]))
    expect(facts).toHaveLength(2)
    for (const fact of facts) {
      expect(fact.consumptionClass).toBe(byId.get(fact.id)!.consumptionClass)
    }
  }, 120_000)

  it('stamps a reversal, and a reversal of it, with the first original’s class', async () => {
    const o = await seedOrg()
    const sale: StockMovementInput = {
      partInstanceId: o.partIds[0]!,
      type: 'sale',
      quantity: -2,
      unitCost: 100,
      costBasis: 'standard',
      glRole: GL,
      occurredAt: AT,
    }
    const [original] = (await write(o, [sale]))._unsafeUnwrap().records
    const [undo] = (
      await write(o, [
        { ...sale, type: 'return_in', quantity: 2, links: { reversesMovementId: original!.id } },
      ])
    )._unsafeUnwrap().records
    const [redo] = (
      await write(o, [
        { ...sale, type: 'return_out', quantity: -2, links: { reversesMovementId: undo!.id } },
      ])
    )._unsafeUnwrap().records
    const [salvage] = (
      await write(o, [{ ...sale, type: 'return_in', quantity: 1 }])
    )._unsafeUnwrap().records

    const rows = await readMovementsByParts(db(), o.organizationId, [o.partIds[0]!])
    const classOf = new Map(rows.map((row) => [row.id, row.consumptionClass]))
    expect(classOf.get(undo!.id)).toBe('consumption')
    expect(classOf.get(redo!.id)).toBe('consumption')
    expect(classOf.get(salvage!.id)).toBe('supply')
  }, 120_000)

  it('refuses a second reversal of the same movement', async () => {
    const o = await seedOrg()
    const base: StockMovementInput = {
      partInstanceId: o.partIds[0]!,
      type: 'adjust',
      quantity: 4,
      unitCost: 100,
      costBasis: 'standard',
      glRole: GL,
      occurredAt: AT,
    }
    const [original] = (await write(o, [base]))._unsafeUnwrap().records
    const reversal = { ...base, quantity: -4, links: { reversesMovementId: original!.id } }
    expect((await write(o, [reversal])).isOk()).toBe(true)
    expect((await write(o, [reversal]))._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
  }, 120_000)
})

describe('deleteMovementsFor', () => {
  it('deletes a line’s movements with their reversals and facts, and names surviving parts', async () => {
    const o = await seedOrg()
    const [sale] = (
      await write(o, [
        {
          partInstanceId: o.partIds[0]!,
          type: 'sale',
          quantity: -1,
          unitCost: 50,
          costBasis: 'standard',
          glRole: GL,
          occurredAt: AT,
          links: { fulfillmentLineId: o.fulfillmentLineId },
        },
      ])
    )._unsafeUnwrap().records
    // A reversal that does not carry the line still goes: it points at a doomed row.
    await write(o, [
      {
        partInstanceId: o.partIds[0]!,
        type: 'return_in',
        quantity: 1,
        unitCost: 50,
        costBasis: 'standard',
        glRole: GL,
        occurredAt: AT,
        links: { reversesMovementId: sale!.id },
      },
    ])

    const result = (
      await db().transaction((tx: Transaction) =>
        deleteMovementsFor(tx, o.organizationId, { fulfillmentLineIds: [o.fulfillmentLineId] })
      )
    )._unsafeUnwrap()

    expect(result.deletedIds).toHaveLength(2)
    expect(result.touched).toMatchObject({ partIds: [o.partIds[0]], fulfillmentLineIds: [] })
    expect(await readMovementsByParts(db(), o.organizationId, o.partIds)).toEqual([])
    const facts = await db()
      .select()
      .from(schema.InventoryMovementFact)
      .where(inArray(schema.InventoryMovementFact.id, result.deletedIds))
    expect(facts).toEqual([])
  }, 120_000)
})
