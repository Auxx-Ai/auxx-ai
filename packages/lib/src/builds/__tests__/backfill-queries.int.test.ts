// packages/lib/src/builds/__tests__/backfill-queries.int.test.ts
//
// The aggregate read behind the bulk builder, against a REAL database
// (`plans/money/tasks/44-auto-build-cutoff-and-backfill.md` sections 7.1/7.1a).
//
// 🛑 **This file exists because the rules that matter here live in SQL.** Which
// build statuses count as coverage, whether a cancelled order contributes
// demand, whether the range is applied to `order_placed_at` or to the row's
// `createdAt` — every one of those is a `WHERE` or a join predicate, and the
// default vitest config mocks `@auxx/database` into a Proxy whose columns are
// `undefined`, so a double there cannot see any of it. The unit file next door
// covers what a double CAN see (the query budget, the attribution pass) and
// says so at the top.
//
// Rows are written as raw `EntityInstance` + `FieldValue` inserts rather than
// through `UnifiedCrudHandler`. Two reasons: `build_status` is guarded against
// any manual write of `in_progress`/`completed`/`canceled`
// (`field-hooks/pre/build-status-guard.ts`), and a real order write would fire
// the drift reconciler, which raises builds — the exact rows this file is
// asserting the ABSENCE of.
//
// Run: npx vitest run --config vitest.integration.config.ts src/builds

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { createEntityDefinitions } from '../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../seed/entity-seeder/create-fields'
import { linkDisplayFields } from '../../seed/entity-seeder/link-display-fields'
import { linkRelationships } from '../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../seed/entity-seeder/types'
import { readBackfillPlanReads } from '../backfill-queries'

const db = () => getTestDb() as unknown as Database

/** The only defs the backfill read touches. Narrowed, because field seeding is the cost. */
const BACKFILL_ENTITY_TYPES = ['order', 'line_item', 'part', 'subpart', 'build'] as const

const JANUARY = {
  from: new Date('2026-01-01T00:00:00.000Z'),
  to: new Date('2026-02-01T00:00:00.000Z'),
}
const IN_RANGE = new Date('2026-01-10T00:00:00.000Z')
const OUT_OF_RANGE = new Date('2026-03-10T00:00:00.000Z')

interface Fixture {
  organizationId: string
  defId: (entityType: string) => string
  fieldId: (systemAttribute: string) => string
}

let fx: Fixture

/** Seed an org whose five defs and their registry fields are the real ones. */
async function seedBackfillOrg(): Promise<Fixture> {
  const org = await createTestOrganization()
  const user = await createTestUser({ name: 'Backfill Operator' })
  await db()
    .update(schema.Organization)
    .set({ systemUserId: user.id })
    .where(eq(schema.Organization.id, org.id))

  // Every definition — `getCachedEntityDefId` reads the whole org — but only the
  // five defs this read touches get their registry fields materialised.
  const entityDefMap = await createEntityDefinitions(db(), org.id)
  const narrowed: EntityDefMap = new Map()
  for (const entityType of BACKFILL_ENTITY_TYPES) {
    const def = entityDefMap.get(entityType)
    if (!def) throw new Error(`fixture: no ${entityType} entity definition was seeded`)
    narrowed.set(entityType, def)
  }
  const fieldMap = await createAllFields(db(), org.id, narrowed)
  await linkRelationships(db(), narrowed, fieldMap)
  await linkDisplayFields(db(), narrowed, fieldMap)

  const fields = await db()
    .select({
      id: schema.CustomField.id,
      systemAttribute: schema.CustomField.systemAttribute,
    })
    .from(schema.CustomField)
    .where(eq(schema.CustomField.organizationId, org.id))

  const byAttribute = new Map<string, string>()
  for (const field of fields) {
    if (field.systemAttribute) byAttribute.set(field.systemAttribute, field.id)
  }

  return {
    organizationId: org.id,
    defId: (entityType) => {
      const def = narrowed.get(entityType)
      if (!def) throw new Error(`fixture: no ${entityType} entity definition was seeded`)
      return def.id
    },
    fieldId: (systemAttribute) => {
      const id = byAttribute.get(systemAttribute)
      if (!id) throw new Error(`fixture: no ${systemAttribute} field was seeded`)
      return id
    },
  }
}

/** One typed `FieldValue` column, keyed by the attribute that owns it. */
type ValueColumns = Partial<{
  valueNumber: number
  valueDate: string
  optionId: string
  relatedEntityId: string
}>

/** Write one instance plus its field values, with no hooks and no CRUD layer. */
async function writeRecord(
  entityType: string,
  values: Record<string, ValueColumns>,
  createdAt?: Date
): Promise<string> {
  const entityDefinitionId = fx.defId(entityType)
  const [instance] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: fx.organizationId,
      entityDefinitionId,
      displayName: entityType,
      // Explicit: the live column carries no DB-side default, so drizzle's
      // `defaultNow()` renders as `default` and the insert fails not-null.
      updatedAt: new Date(),
      ...(createdAt ? { createdAt } : {}),
    })
    .returning({ id: schema.EntityInstance.id })
  if (!instance) throw new Error(`fixture: could not write a ${entityType}`)

  const rows = Object.entries(values).map(([systemAttribute, columns]) => ({
    organizationId: fx.organizationId,
    entityId: instance.id,
    entityDefinitionId,
    fieldId: fx.fieldId(systemAttribute),
    updatedAt: new Date(),
    ...columns,
  }))
  if (rows.length > 0) await db().insert(schema.FieldValue).values(rows)
  return instance.id
}

/** A finished good with a one-component bill of materials. */
async function seedBuiltPart(): Promise<string> {
  const partId = await writeRecord('part', { part_kind: { optionId: 'finished_good' } })
  const componentId = await writeRecord('part', { part_kind: { optionId: 'component' } })
  await writeRecord('subpart', {
    subpart_parent_part: { relatedEntityId: partId },
    subpart_child_part: { relatedEntityId: componentId },
    subpart_quantity: { valueNumber: 2 },
  })
  return partId
}

/** An order carrying one line for `partId`, and its id. */
async function seedOrderWithLine(
  partId: string,
  options: { placedAt?: Date; cancelledAt?: Date; createdAt?: Date; quantity?: number } = {}
): Promise<string> {
  const orderValues: Record<string, ValueColumns> = {}
  if (options.placedAt) orderValues.order_placed_at = { valueDate: options.placedAt.toISOString() }
  if (options.cancelledAt) {
    orderValues.order_cancelled_at = { valueDate: options.cancelledAt.toISOString() }
  }
  const orderId = await writeRecord('order', orderValues, options.createdAt)

  await writeRecord('line_item', {
    line_item_order: { relatedEntityId: orderId },
    line_item_part: { relatedEntityId: partId },
    line_item_qty: { valueNumber: options.quantity ?? 2 },
  })
  return orderId
}

async function seedBuild(
  partId: string,
  values: Record<string, ValueColumns> = {}
): Promise<string> {
  return writeRecord('build', {
    build_part: { relatedEntityId: partId },
    build_status: { optionId: 'planned' },
    build_quantity_planned: { valueNumber: 5 },
    ...values,
  })
}

async function read(range = JANUARY) {
  const result = await readBackfillPlanReads(db(), fx.organizationId, range)
  if (result.isErr()) throw result.error
  return result.value
}

beforeEach(async () => {
  // A fresh org per test, so nothing the org cache memoized for the previous
  // one can be read back — `per-test-setup` truncates every table between tests.
  fx = await seedBackfillOrg()
})

describe('demand', () => {
  it('reads a line whose order was placed inside the range', async () => {
    const partId = await seedBuiltPart()
    const orderId = await seedOrderWithLine(partId, { placedAt: IN_RANGE, quantity: 3 })

    const { lines } = await read()

    expect(lines).toEqual([{ orderId, partId, quantity: 3, placedAt: IN_RANGE }])
  })

  it('falls back to the row’s createdAt when the order carries no placed date', async () => {
    // An order typed by hand in auxx may have no business date at all. Falling
    // back to when the row was made keeps it inside the window rather than
    // silently dropping it — the same fallback `loadAutoBuildOrders` applies.
    const partId = await seedBuiltPart()
    await seedOrderWithLine(partId, { createdAt: IN_RANGE })

    const { lines } = await read()

    expect(lines).toHaveLength(1)
    expect(lines[0]?.placedAt).toEqual(IN_RANGE)
  })

  it('excludes an order placed outside the range', async () => {
    const partId = await seedBuiltPart()
    await seedOrderWithLine(partId, { placedAt: OUT_OF_RANGE })

    const { lines } = await read()

    expect(lines).toEqual([])
  })

  it('🛑 excludes a cancelled order', async () => {
    // Its demand is not demand. The comparison is on the presence of
    // `order_cancelled_at`, exactly as the auto-build trigger reads it.
    const partId = await seedBuiltPart()
    await seedOrderWithLine(partId, { placedAt: IN_RANGE, cancelledAt: IN_RANGE })

    const { lines } = await read()

    expect(lines).toEqual([])
  })

  it('drops a line that reaches no part', async () => {
    const partId = await seedBuiltPart()
    const orderId = await seedOrderWithLine(partId, { placedAt: IN_RANGE })
    await writeRecord('line_item', {
      line_item_order: { relatedEntityId: orderId },
      line_item_qty: { valueNumber: 9 },
    })

    const { lines } = await read()

    expect(lines).toHaveLength(1)
  })

  it('keeps two lines for the same part on one order, uncollapsed', async () => {
    const partId = await seedBuiltPart()
    const orderId = await seedOrderWithLine(partId, { placedAt: IN_RANGE, quantity: 2 })
    await writeRecord('line_item', {
      line_item_order: { relatedEntityId: orderId },
      line_item_part: { relatedEntityId: partId },
      line_item_qty: { valueNumber: 3 },
    })

    const { lines } = await read()

    expect(lines.map((line) => line.quantity).sort()).toEqual([2, 3])
  })
})

describe('coverage', () => {
  let partId: string
  let orderId: string

  beforeEach(async () => {
    partId = await seedBuiltPart()
    orderId = await seedOrderWithLine(partId, { placedAt: IN_RANGE, quantity: 10 })
  })

  it('counts a planned order-raised build, at its order’s date', async () => {
    await seedBuild(partId, {
      build_order: { relatedEntityId: orderId },
      build_quantity_planned: { valueNumber: 4 },
    })

    const { coverage } = await read()

    expect(coverage).toEqual([{ partId, quantity: 4, appliesAt: IN_RANGE }])
  })

  it('counts an in_progress build', async () => {
    await seedBuild(partId, { build_status: { optionId: 'in_progress' } })

    const { coverage } = await read()

    expect(coverage).toHaveLength(1)
  })

  it('🛑 does NOT count a completed build', async () => {
    // Section 7.1a, and this is the shape of the bug: `completeBuild` wrote a
    // `build_produce` movement and `recalculatePartQoH` re-SUMmed the ledger, so
    // those units are already in `part_quantity_on_hand`. Counting them here as
    // well, while also subtracting on hand, under-builds by exactly the produced
    // quantity. The fixture writes the resulting on-hand alongside, so the two
    // halves of the double count are both present.
    await seedBuild(partId, { build_status: { optionId: 'completed' } })
    await db()
      .insert(schema.FieldValue)
      .values({
        organizationId: fx.organizationId,
        entityId: partId,
        entityDefinitionId: fx.defId('part'),
        fieldId: fx.fieldId('part_quantity_on_hand'),
        updatedAt: new Date(),
        valueNumber: 5,
      })

    const { coverage, quantitiesOnHand } = await read()

    expect(coverage).toEqual([])
    expect(quantitiesOnHand.get(partId)).toBe(5)
  })

  it('🛑 does NOT count a canceled build', async () => {
    await seedBuild(partId, { build_status: { optionId: 'canceled' } })

    const { coverage } = await read()

    expect(coverage).toEqual([])
  })

  it('🛑 counts a planned MANUAL build, as undated coverage', async () => {
    // Diverges from `reconcile-policy.ts` on purpose (section 7.1a): the
    // aggregate asks whether enough production is planned, and a planned manual
    // build will produce units. Do not align the two models.
    await seedBuild(partId, {
      build_source: { optionId: 'manual' },
      build_quantity_planned: { valueNumber: 6 },
    })

    const { coverage } = await read()

    expect(coverage).toEqual([{ partId, quantity: 6, appliesAt: null }])
  })

  it('counts a batch build at its own period start', async () => {
    await seedBuild(partId, {
      build_source: { optionId: 'batch' },
      build_quantity_planned: { valueNumber: 8 },
      build_period_start: { valueDate: JANUARY.from.toISOString() },
      build_period_end: { valueDate: JANUARY.to.toISOString() },
    })

    const { coverage } = await read()

    expect(coverage).toEqual([{ partId, quantity: 8, appliesAt: JANUARY.from }])
  })

  it('drops a build raised against an order outside the range', async () => {
    const otherOrderId = await seedOrderWithLine(partId, { placedAt: OUT_OF_RANGE })
    await seedBuild(partId, { build_order: { relatedEntityId: otherOrderId } })

    const { coverage } = await read()

    expect(coverage).toEqual([])
  })

  it('ignores a build for a part nothing in the range ordered', async () => {
    const otherPartId = await seedBuiltPart()
    await seedBuild(otherPartId)

    const { coverage } = await read()

    expect(coverage).toEqual([])
  })

  it('ignores an archived build', async () => {
    const buildId = await seedBuild(partId)
    await db()
      .update(schema.EntityInstance)
      .set({ archivedAt: new Date() })
      .where(eq(schema.EntityInstance.id, buildId))

    const { coverage } = await read()

    expect(coverage).toEqual([])
  })
})

describe('the per-part maps', () => {
  it('reports a bill of materials only for the part that has one', async () => {
    const builtPartId = await seedBuiltPart()
    const bareId = await writeRecord('part', { part_kind: { optionId: 'finished_good' } })
    await seedOrderWithLine(builtPartId, { placedAt: IN_RANGE })
    await seedOrderWithLine(bareId, { placedAt: IN_RANGE })

    const { hasBom, partKinds } = await read()

    expect(hasBom.get(builtPartId)).toBe(true)
    expect(hasBom.get(bareId)).toBeUndefined()
    expect(partKinds.get(builtPartId)).toBe('finished_good')
  })

  it('ignores a subpart edge with a non-positive quantity', async () => {
    // Same edge semantics as `loadDirectSubparts`, which is the function this
    // batched check replaces.
    const partId = await writeRecord('part', { part_kind: { optionId: 'finished_good' } })
    const componentId = await writeRecord('part', { part_kind: { optionId: 'component' } })
    await writeRecord('subpart', {
      subpart_parent_part: { relatedEntityId: partId },
      subpart_child_part: { relatedEntityId: componentId },
      subpart_quantity: { valueNumber: 0 },
    })
    await seedOrderWithLine(partId, { placedAt: IN_RANGE })

    const { hasBom } = await read()

    expect(hasBom.get(partId)).toBeUndefined()
  })
})

describe('the query budget', () => {
  it('🛑 issues the same five queries for twelve orders as for one', async () => {
    // Section 4.1: the historical lane must not inherit `readOrderRaisedBuilds`'s
    // one-read-per-order cost, and a regression here would be invisible in every
    // other assertion in this file.
    const partId = await seedBuiltPart()
    for (let index = 0; index < 12; index += 1) {
      const orderId = await seedOrderWithLine(partId, { placedAt: IN_RANGE })
      await seedBuild(partId, { build_order: { relatedEntityId: orderId } })
    }

    const counter = { selects: 0 }
    const counting = new Proxy(db() as object, {
      get(target, prop) {
        const value = Reflect.get(target, prop)
        if (typeof value !== 'function') return value
        if (prop === 'select') {
          return (...args: unknown[]) => {
            counter.selects += 1
            return value.apply(target, args)
          }
        }
        return value.bind(target)
      },
    }) as unknown as Database

    const result = await readBackfillPlanReads(counting, fx.organizationId, JANUARY)
    if (result.isErr()) throw result.error

    expect(result.value.lines).toHaveLength(12)
    expect(result.value.coverage).toHaveLength(12)
    expect(counter.selects).toBe(5)
  })
})
