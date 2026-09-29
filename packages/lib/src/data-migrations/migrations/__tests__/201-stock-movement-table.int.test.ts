// packages/lib/src/data-migrations/migrations/__tests__/201-stock-movement-table.int.test.ts
// Migration 201 against a real database: EAV movements copied under their ids, the entity deleted,
// QoH re-derived. The EAV side is built with raw inserts so the test outlives the registry entry.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, eq, inArray, or } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { UnifiedCrudHandler } from '../../../resources/crud/unified-handler'
import { PartKind } from '../../../resources/registry/enum-values'
import { createEntityDefinitions } from '../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../seed/entity-seeder/create-fields'
import { linkDisplayFields } from '../../../seed/entity-seeder/link-display-fields'
import { linkRelationships } from '../../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../../seed/entity-seeder/types'
import { migration201StockMovementTable } from '../201-stock-movement-table'

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

/** The movement fields this org has; the 175 accrual fields are deliberately missing. */
const FIELDS = {
  stock_movement_part: 'RELATIONSHIP',
  stock_movement_type: 'SINGLE_SELECT',
  stock_movement_quantity: 'NUMBER',
  stock_movement_adjust_subparts: 'CHECKBOX',
  stock_movement_unit_cost: 'CURRENCY',
  stock_movement_extended_cost: 'CURRENCY',
  stock_movement_cost_basis: 'SINGLE_SELECT',
  stock_movement_gl_account: 'TEXT',
  stock_movement_occurred_at: 'DATETIME',
  stock_movement_build: 'RELATIONSHIP',
  stock_movement_fulfillment_line: 'RELATIONSHIP',
  stock_movement_reverses_movement: 'RELATIONSHIP',
  stock_movement_count_quantity: 'NUMBER',
  stock_movement_count_date: 'DATE',
} as const
type Attr = keyof typeof FIELDS

type Value =
  | { related: string }
  | { option: string }
  | { number: number }
  | { bool: boolean }
  | { text: string }
  | { date: string }

async function seed() {
  const org = await createTestOrganization()
  const user = await createTestUser()
  const organizationId = org.id
  const all = await createEntityDefinitions(db(), organizationId)
  const defs: EntityDefMap = new Map(
    [...all].filter(([kind]) => ['part', 'subpart', 'build', 'fulfillment_line'].includes(kind))
  )
  const made = await createAllFields(db(), organizationId, defs)
  await linkRelationships(db(), defs, made)
  await linkDisplayFields(db(), defs, made)

  // The seeder may or may not still create the movement def; the migration only reads rows.
  const existing = all.get('stock_movement')
  const movementDefId =
    existing?.id ??
    (
      await db()
        .insert(schema.EntityDefinition)
        .values({
          organizationId,
          apiSlug: 'stock-movements',
          singular: 'Stock Movement',
          plural: 'Stock Movements',
          entityType: 'stock_movement',
          updatedAt: new Date(),
        })
        .returning()
    )[0]!.id
  await db()
    .delete(schema.CustomField)
    .where(eq(schema.CustomField.entityDefinitionId, movementDefId))
  const fieldRows = await db()
    .insert(schema.CustomField)
    .values(
      Object.entries(FIELDS).map(([attribute, type]) => ({
        organizationId,
        entityDefinitionId: movementDefId,
        name: attribute,
        type,
        systemAttribute: attribute,
        isCustom: false,
        modelType: 'entity',
        updatedAt: new Date(),
      }))
    )
    .returning()
  const fieldId = new Map(fieldRows.map((row) => [row.systemAttribute as Attr, row.id]))
  const [mirror] = await db()
    .insert(schema.CustomField)
    .values({
      organizationId,
      entityDefinitionId: defs.get('part')!.id,
      name: 'Stock Movements (legacy)',
      type: 'RELATIONSHIP',
      systemAttribute: 'part_stock_movements',
      isCustom: false,
      modelType: 'entity',
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning()
  const mirrorFieldId =
    mirror?.id ??
    (
      await db()
        .select({ id: schema.CustomField.id })
        .from(schema.CustomField)
        .where(
          and(
            eq(schema.CustomField.organizationId, organizationId),
            eq(schema.CustomField.systemAttribute, 'part_stock_movements')
          )
        )
    )[0]!.id

  const crud = new UnifiedCrudHandler(organizationId, user.id, db())
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
      organizationId,
      entityDefinitionId: defs.get('fulfillment_line')!.id,
      updatedAt: new Date(),
    })
    .returning()

  let mirrorRows = 0
  /** One EAV movement: its instance, its values and the part's mirror row. */
  const movement = async (values: Partial<Record<Attr, Value>>): Promise<string> => {
    const [instance] = await db()
      .insert(schema.EntityInstance)
      .values({
        organizationId,
        entityDefinitionId: movementDefId,
        createdById: user.id,
        updatedAt: new Date(),
      })
      .returning()
    const id = instance!.id
    await db()
      .insert(schema.FieldValue)
      .values(
        Object.entries(values).map(([attribute, value]) => ({
          organizationId,
          entityId: id,
          entityDefinitionId: movementDefId,
          fieldId: fieldId.get(attribute as Attr)!,
          relatedEntityId: 'related' in value ? value.related : null,
          optionId: 'option' in value ? value.option : null,
          valueNumber: 'number' in value ? value.number : null,
          valueBoolean: 'bool' in value ? value.bool : null,
          valueText: 'text' in value ? value.text : null,
          valueDate: 'date' in value ? value.date : null,
        }))
      )
    const part = values.stock_movement_part
    if (part && 'related' in part) {
      await db()
        .insert(schema.FieldValue)
        .values({
          organizationId,
          entityId: part.related,
          entityDefinitionId: defs.get('part')!.id,
          fieldId: mirrorFieldId,
          relatedEntityId: id,
          relatedEntityDefinitionId: movementDefId,
          // Unique per (part, field): the mirror is a has_many list.
          sortKey: `a${mirrorRows++}`,
        })
    }
    return id
  }

  return { organizationId, userId: user.id, movementDefId, partIds, lineId: line!.id, movement }
}

const AT = '2026-03-15T12:00:00.000Z'

async function qoh(organizationId: string, partId: string): Promise<number | null> {
  const [row] = await db()
    .select({ value: schema.FieldValue.valueNumber })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, partId),
        eq(schema.CustomField.systemAttribute, 'part_quantity_on_hand')
      )
    )
  return row?.value ?? null
}

describe('migration 201', () => {
  it('copies movements under their ids, drops orphans, deletes the entity and re-derives QoH', async () => {
    const s = await seed()
    const [mast, pump] = s.partIds as [string, string]
    const part = (id: string) => ({ related: id })

    const receipt = await s.movement({
      stock_movement_part: part(mast),
      stock_movement_type: { option: 'receive' },
      stock_movement_quantity: { number: 5 },
      stock_movement_adjust_subparts: { bool: false },
      stock_movement_unit_cost: { number: 1.594 },
      stock_movement_extended_cost: { number: 797 },
      stock_movement_cost_basis: { option: 'standard' },
      stock_movement_gl_account: { text: 'inventory_raw_materials' },
      stock_movement_occurred_at: { date: AT },
    })
    const sale = await s.movement({
      stock_movement_part: part(mast),
      stock_movement_type: { option: 'sale' },
      stock_movement_quantity: { number: -2 },
      stock_movement_cost_basis: { option: 'pending' },
      stock_movement_fulfillment_line: { related: s.lineId },
      stock_movement_occurred_at: { date: AT },
    })
    const reversal = await s.movement({
      stock_movement_part: part(mast),
      stock_movement_type: { option: 'receive' },
      stock_movement_quantity: { number: -5 },
      stock_movement_unit_cost: { number: 1.594 },
      stock_movement_extended_cost: { number: -797 },
      stock_movement_cost_basis: { option: 'standard' },
      stock_movement_reverses_movement: { related: receipt },
    })
    // A standard basis with no cost contradicts the pending check; its build is long gone.
    const consume = await s.movement({
      stock_movement_part: part(pump),
      stock_movement_type: { option: 'build_consume' },
      stock_movement_quantity: { number: -0.5 },
      stock_movement_cost_basis: { option: 'standard' },
      stock_movement_build: { related: 'gone-build-0000000000000' },
    })
    const initial = await s.movement({
      stock_movement_part: part(pump),
      stock_movement_type: { option: 'initial' },
      stock_movement_quantity: { number: 10 },
      stock_movement_count_quantity: { number: 10 },
      stock_movement_count_date: { date: '2026-01-31T00:00:00.000Z' },
    })
    await s.movement({
      stock_movement_part: { related: 'gone-part-00000000000000' },
      stock_movement_type: { option: 'adjust' },
      stock_movement_quantity: { number: 3 },
    })

    const result = await migration201StockMovementTable.up(db(), s.organizationId)
    expect(result).toMatchObject({
      alreadyUpToDate: false,
      movementsCopied: 5,
      orphansDropped: 1,
      partsRecomputed: 2,
    })

    const rows = await db()
      .select()
      .from(schema.StockMovement)
      .where(eq(schema.StockMovement.organizationId, s.organizationId))
    const byId = new Map(rows.map((row) => [row.id, row]))
    expect([...byId.keys()].sort()).toEqual([receipt, sale, reversal, consume, initial].sort())
    expect(byId.get(receipt)).toMatchObject({
      partId: mast,
      type: 'receive',
      quantity: 5,
      unitCostMinor: 1.594,
      extendedCostMinor: 797,
      costBasis: 'standard',
      glRole: 'inventory_raw_materials',
      adjustSubparts: false,
      createdById: s.userId,
      freightAccruedMinor: null,
    })
    expect(byId.get(receipt)!.occurredAt?.toISOString()).toBe(AT)
    expect(byId.get(sale)).toMatchObject({ fulfillmentLineId: s.lineId, costBasis: 'pending' })
    expect(byId.get(reversal)!.reversesMovementId).toBe(receipt)
    expect(byId.get(consume)).toMatchObject({ buildId: null, costBasis: null, quantity: -0.5 })
    expect(byId.get(initial)).toMatchObject({ countQuantity: 10, countDate: '2026-01-31' })

    const [def] = await db()
      .select()
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.id, s.movementDefId))
    expect(def).toBeUndefined()
    const leftovers = await db()
      .select({ id: schema.FieldValue.id })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, s.organizationId),
          or(
            eq(schema.FieldValue.entityDefinitionId, s.movementDefId),
            eq(schema.FieldValue.relatedEntityDefinitionId, s.movementDefId),
            inArray(schema.FieldValue.entityId, [receipt, sale, reversal, consume, initial])
          )
        )
      )
    expect(leftovers).toEqual([])
    const mirrorFields = await db()
      .select({ id: schema.CustomField.id })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, s.organizationId),
          eq(schema.CustomField.systemAttribute, 'part_stock_movements')
        )
      )
    expect(mirrorFields).toEqual([])

    expect(await qoh(s.organizationId, mast)).toBe(-2)
    expect(await qoh(s.organizationId, pump)).toBe(9.5)

    const again = await migration201StockMovementTable.up(db(), s.organizationId)
    expect(again.alreadyUpToDate).toBe(true)
  })
})
