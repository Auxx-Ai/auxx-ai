// packages/lib/src/resources/crud/__tests__/movement-parent-delete.int.test.ts
// Deleting a part or build through the record handler takes its StockMovement rows with it and
// re-derives the surviving parts' QoH; a settled period still refuses (plans/mrp/20 S9).

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
    [...all].filter(([kind]) => ['part', 'subpart', 'build'].includes(kind))
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
  const [build] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId,
      entityDefinitionId: defs.get('build')!.id,
      createdById: user.id,
      updatedAt: new Date(),
    })
    .returning()

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
  const qoh = async (partId: string) => {
    const [row] = await db()
      .select({ value: schema.FieldValue.valueNumber })
      .from(schema.FieldValue)
      .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
      .where(
        and(
          eq(schema.FieldValue.entityId, partId),
          eq(schema.CustomField.systemAttribute, 'part_quantity_on_hand')
        )
      )
    return row?.value ?? 0
  }

  return {
    organizationId,
    crud,
    partDefId,
    buildDefId: defs.get('build')!.id,
    buildId: build!.id,
    mast: partIds[0]!,
    pump: partIds[1]!,
    write,
    movementsOf,
    qoh,
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
  it('deletes a build with its legs and re-derives the component QoH', async () => {
    const s = await seed()
    await s.write([
      move(s.pump, { quantity: 5 }),
      move(s.mast, { type: 'build_produce', quantity: 1, links: { buildId: s.buildId } }),
      move(s.pump, { type: 'build_consume', quantity: -2, links: { buildId: s.buildId } }),
    ])
    expect(await s.qoh(s.pump)).toBe(3)
    expect(await s.qoh(s.mast)).toBe(1)

    await s.crud.delete(toRecordId(s.buildDefId, s.buildId))

    expect(await s.qoh(s.pump)).toBe(5)
    expect(await s.qoh(s.mast)).toBe(0)
    expect(await s.movementsOf(s.mast)).toEqual([])
    expect(await s.movementsOf(s.pump)).toHaveLength(1)
  })

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
})
