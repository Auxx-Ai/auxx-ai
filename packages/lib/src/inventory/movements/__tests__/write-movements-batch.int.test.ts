// packages/lib/src/inventory/movements/__tests__/write-movements-batch.int.test.ts
//
// `writeStockMovementsBatch` against `writeStockMovements` for the relief and salvage input
// shapes (plans/mrp/12-slice-batched-backflush.md §3, 12b).

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { UnifiedCrudHandler } from '../../../resources/crud/unified-handler'
import { quietSession } from '../../../resources/crud/write-origin'
import {
  PartKind,
  StockMovementCostBasis,
  StockMovementType,
} from '../../../resources/registry/enum-values'
import { createEntityDefinitions } from '../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../seed/entity-seeder/create-fields'
import { linkDisplayFields } from '../../../seed/entity-seeder/link-display-fields'
import { linkRelationships } from '../../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../../seed/entity-seeder/types'
import { resolveInventoryRoleForPartKind } from '../client'
import type { StockMovementInput, StockMovementsCtx } from '../types'
import { writeStockMovements } from '../write-movements'
import { writeStockMovementsBatch } from '../write-movements-batch'

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

/** The defs a relief movement touches, `fulfillment_line` and its own targets included. */
const ENTITY_TYPES = [
  'part',
  'subpart',
  'build',
  'stock_movement',
  'order',
  'line_item',
  'fulfillment',
  'fulfillment_line',
]

interface Org {
  organizationId: string
  userId: string
  movementDefId: string
  partDefId: string
  partIds: string[]
  fulfillmentLineIds: string[]
}

async function seedOrg(): Promise<Org> {
  const org = await createTestOrganization()
  const user = await createTestUser()
  await db()
    .update(schema.Organization)
    .set({ systemUserId: user.id })
    .where(eq(schema.Organization.id, org.id))
  const all = await createEntityDefinitions(db(), org.id)
  const defs: EntityDefMap = new Map([...all].filter(([kind]) => ENTITY_TYPES.includes(kind)))
  const made = await createAllFields(db(), org.id, defs)
  await linkRelationships(db(), defs, made)
  await linkDisplayFields(db(), defs, made)

  const partDefId = defs.get('part')!.id
  const crud = new UnifiedCrudHandler(org.id, user.id, db())
  const partIds: string[] = []
  for (const title of ['Mast', 'Pump']) {
    const created = await crud.create(partDefId, {
      part_title: title,
      part_sku: `SKU-${title.toUpperCase()}`,
      part_kind: PartKind.COMPONENT,
    })
    partIds.push(created.instance.id)
  }
  // Bare targets: the link only needs the instance to exist under the `fulfillment_line` def.
  const fulfillmentLineIds: string[] = []
  for (let i = 0; i < 2; i += 1) {
    const [row] = await db()
      .insert(schema.EntityInstance)
      .values({
        organizationId: org.id,
        entityDefinitionId: defs.get('fulfillment_line')!.id,
        createdById: user.id,
        updatedAt: new Date(),
      })
      .returning()
    fulfillmentLineIds.push(row!.id)
  }
  return {
    organizationId: org.id,
    userId: user.id,
    movementDefId: defs.get('stock_movement')!.id,
    partDefId,
    partIds,
    fulfillmentLineIds,
  }
}

const OCCURRED_AT = new Date('2026-03-15T12:00:00.000Z')
const GL = resolveInventoryRoleForPartKind(PartKind.COMPONENT)

/** Relief's shape: `sale`, negative, linked to its line; one pending row, one standard. */
function reliefInputs(o: Org): StockMovementInput[] {
  return [
    {
      partInstanceId: o.partIds[0]!,
      type: StockMovementType.SALE,
      quantity: -2,
      unitCost: null,
      costBasis: StockMovementCostBasis.PENDING,
      glAccount: GL,
      occurredAt: OCCURRED_AT,
      links: { fulfillmentLineId: o.fulfillmentLineIds[0]! },
    },
    {
      partInstanceId: o.partIds[1]!,
      type: StockMovementType.SALE,
      quantity: -3,
      unitCost: 1_250,
      costBasis: StockMovementCostBasis.STANDARD,
      glAccount: GL,
      occurredAt: OCCURRED_AT,
      links: { fulfillmentLineId: o.fulfillmentLineIds[1]! },
    },
  ]
}

/** Salvage's shape: `return_in`, positive, a reason, no links. */
function salvageInputs(o: Org): StockMovementInput[] {
  return o.partIds.map((partInstanceId, index) => ({
    partInstanceId,
    type: StockMovementType.RETURN_IN,
    quantity: index + 1,
    unitCost: 800 * (index + 1),
    costBasis: StockMovementCostBasis.STANDARD,
    glAccount: GL,
    occurredAt: OCCURRED_AT,
    reason: 'Salvaged from return RL-1',
  }))
}

/** Write `inputs` through `writer` on a quiet session inside one transaction. */
async function write(
  o: Org,
  writer: typeof writeStockMovements,
  inputs: StockMovementInput[]
): Promise<string[]> {
  const session = quietSession('movement batch equivalence test', { coveredBy: 'test' })
  return db().transaction(async (tx) => {
    const ctx: StockMovementsCtx = {
      db: tx as unknown as Database,
      organizationId: o.organizationId,
      userId: o.userId,
      movementDefId: o.movementDefId,
      partDefId: o.partDefId,
      lane: { kind: 'quiet', session },
    }
    const written = await writer(ctx, inputs)
    return written._unsafeUnwrap().records.map((record) => record.movementId)
  })
}

/** Instances, values, inverse mirrors and fact rows of `ids`, ids and times stripped. */
async function stored(ids: string[]) {
  const at = (id: string | null) => ids.indexOf(id ?? '')
  const instances = await db()
    .select()
    .from(schema.EntityInstance)
    .where(inArray(schema.EntityInstance.id, ids))
  const values = await db()
    .select()
    .from(schema.FieldValue)
    .where(inArray(schema.FieldValue.entityId, ids))
    .orderBy(asc(schema.FieldValue.fieldId), asc(schema.FieldValue.sortKey))
  const mirrors = await db()
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        inArray(schema.FieldValue.relatedEntityId, ids),
        ne(schema.FieldValue.entityDefinitionId, instances[0]?.entityDefinitionId ?? '')
      )
    )
    .orderBy(asc(schema.FieldValue.entityId), asc(schema.FieldValue.fieldId))
  const facts = await db()
    .select()
    .from(schema.InventoryMovementFact)
    .where(inArray(schema.InventoryMovementFact.id, ids))
  return {
    instances: instances
      .map(({ id, createdAt: _c, updatedAt: _u, lastActivityAt: _l, ...rest }) => ({
        ...rest,
        at: at(id),
      }))
      .sort((a, b) => a.at - b.at),
    values: values
      .map(({ id: _i, createdAt: _c, updatedAt: _u, entityId, ...rest }) => ({
        ...rest,
        at: at(entityId),
      }))
      .sort((a, b) => a.at - b.at || a.fieldId.localeCompare(b.fieldId)),
    mirrors: mirrors.map(
      ({ id: _i, createdAt: _c, updatedAt: _u, relatedEntityId, sortKey: _s, ...rest }) => ({
        ...rest,
        at: at(relatedEntityId),
      })
    ),
    facts: facts
      .map(({ id, createdAt: _c, ...rest }) => ({
        ...rest,
        at: at(id),
      }))
      .sort((a, b) => a.at - b.at),
  }
}

describe('writeStockMovementsBatch stores what writeStockMovements stores', () => {
  it('relief-shaped inputs: sale, linked, one pending and one standard row', async () => {
    const o = await seedOrg()
    const a = await stored(await write(o, writeStockMovements, reliefInputs(o)))
    const b = await stored(await write(o, writeStockMovementsBatch, reliefInputs(o)))

    expect(b.instances).toEqual(a.instances)
    expect(b.values).toEqual(a.values)
    expect(b.mirrors).toEqual(a.mirrors)
    expect(b.facts).toEqual(a.facts)
    expect(a.facts.map((fact) => fact.fulfillmentLineId)).toEqual(o.fulfillmentLineIds)
    expect(a.mirrors.length).toBeGreaterThan(0)
    expect(a.values.length).toBeGreaterThan(10)
  }, 120_000)

  it('salvage-shaped inputs: return_in, a reason, no links', async () => {
    const o = await seedOrg()
    const a = await stored(await write(o, writeStockMovements, salvageInputs(o)))
    const b = await stored(await write(o, writeStockMovementsBatch, salvageInputs(o)))

    expect(b.instances).toEqual(a.instances)
    expect(b.values).toEqual(a.values)
    expect(b.facts).toEqual(a.facts)
    expect(a.facts).toHaveLength(2)
    expect(a.values.length).toBeGreaterThan(10)
  }, 120_000)
})
