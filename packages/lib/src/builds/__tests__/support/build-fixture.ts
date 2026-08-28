// packages/lib/src/builds/__tests__/support/build-fixture.ts
//
// A real, DB-backed organization that the build write paths can run against
// end to end, for the two `*.int.test.ts` files next door.
//
// Everything here is REAL: the entity definitions and their `CustomField` rows
// come from the same two seeder passes `EntitySeeder` runs
// (`createEntityDefinitions` + `createAllFields`, then the relationship and
// display links), the parts and subparts are written through
// `UnifiedCrudHandler`, and the org cache is the production one falling back to
// its in-memory layer. That is the point — both gaps these fixtures serve are
// about WIRING (does a write land on `tx`; does a bypass reach the guard), and
// wiring is precisely what a double cannot answer.
//
// The one thing written as raw `FieldValue` rows is the frozen standard cost.
// `part_standard_cost` and its three components are `creatable: false,
// updatable: false` — `rollStandardCost` is their only writer — so there is no
// CRUD door to write them through. They are an INPUT to every test here, never
// the thing under test.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import { UnifiedCrudHandler } from '../../../resources/crud/unified-handler'
import { PartKind } from '../../../resources/registry/enum-values'
import { toRecordId } from '../../../resources/resource-id'
import { createEntityDefinitions } from '../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../seed/entity-seeder/create-fields'
import { linkDisplayFields } from '../../../seed/entity-seeder/link-display-fields'
import { linkRelationships } from '../../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../../seed/entity-seeder/types'

const db = () => getTestDb() as unknown as Database

/** The only defs whose registry fields a build path ever reads or writes. */
const BUILD_ENTITY_TYPES = ['build', 'part', 'subpart', 'stock_movement'] as const

/** Everything the build tests need to address the seeded org. */
export interface BuildFixture {
  organizationId: string
  userId: string
  buildDefId: string
  partDefId: string
  subpartDefId: string
  movementDefId: string
  /** The finished good the build produces. */
  producedPartId: string
  /** The BOM components, in BOM order. */
  componentPartIds: string[]
  /** `partId` -> the frozen `part_standard_cost` in minor units. */
  standardCosts: Map<string, number>
  /** `partId` -> qty per produced unit, for the BOM edges. */
  qtyPerUnit: Map<string, number>
}

export interface SeedBuildOrgOptions {
  /** How many BOM components the produced part gets. Default 3. */
  components?: number
}

/**
 * Seed an organization whose `build`, `part`, `subpart` and `stock_movement`
 * definitions and fields are the registry's own, then give it one buildable
 * finished good with a priced bill of materials.
 */
export async function seedBuildOrg(options: SeedBuildOrgOptions = {}): Promise<BuildFixture> {
  const componentCount = options.components ?? 3

  const org = await createTestOrganization()
  const user = await createTestUser({ name: 'Build Operator' })
  await db()
    .update(schema.Organization)
    .set({ systemUserId: user.id })
    .where(eq(schema.Organization.id, org.id))

  // The two passes that materialise defs + fields, plus the two link passes the
  // relationship writes below need. Views and dashboards are not read by any
  // build path, so passes 6 to 8 are skipped.
  //
  // EVERY definition — `getCachedEntityDefId` and the resource cache read the
  // whole org, and defs are one cheap insert each.
  const entityDefMap = await createEntityDefinitions(db(), org.id)

  // ...but only the four defs a build actually touches get their ~1,000
  // registry fields materialised. `createAllFields` keys off the map it is
  // handed, so narrowing it here is the difference between a ~1.2s fixture and
  // a ~12s one, repeated once per test because `per-test-setup` truncates every
  // table after each one. Nothing below reads a field on any other def.
  const buildDefMap: EntityDefMap = new Map()
  for (const entityType of BUILD_ENTITY_TYPES) {
    const def = entityDefMap.get(entityType)
    if (!def) throw new Error(`fixture: no ${entityType} entity definition was seeded`)
    buildDefMap.set(entityType, def)
  }

  const fieldMap = await createAllFields(db(), org.id, buildDefMap)
  await linkRelationships(db(), buildDefMap, fieldMap)
  await linkDisplayFields(db(), buildDefMap, fieldMap)

  const defId = (entityType: string): string => {
    const def = buildDefMap.get(entityType)
    if (!def) throw new Error(`fixture: no ${entityType} entity definition was seeded`)
    return def.id
  }

  const buildDefId = defId('build')
  const partDefId = defId('part')
  const subpartDefId = defId('subpart')
  const movementDefId = defId('stock_movement')

  const crud = new UnifiedCrudHandler(org.id, user.id, db())

  const createPart = async (title: string, kind: string): Promise<string> => {
    const created = await crud.create(partDefId, {
      part_title: title,
      part_sku: `SKU-${title.replace(/\s+/g, '-').toUpperCase()}`,
      part_kind: kind,
    })
    return created.instance.id
  }

  const producedPartId = await createPart('Auxx Lift 400lbs 4x8', PartKind.FINISHED_GOOD)

  const componentPartIds: string[] = []
  const qtyPerUnit = new Map<string, number>()
  for (let index = 0; index < componentCount; index += 1) {
    const partId = await createPart(`Component ${index + 1}`, PartKind.COMPONENT)
    componentPartIds.push(partId)
    // Distinct quantities, so a test that mixed two lines up would show it.
    qtyPerUnit.set(partId, index + 1)
    await crud.create(subpartDefId, {
      subpart_parent_part: toRecordId(partDefId, producedPartId),
      subpart_child_part: toRecordId(partDefId, partId),
      subpart_quantity: index + 1,
    })
  }

  // Frozen standards, in minor units. Distinct per part for the same reason the
  // quantities are.
  const standardCosts = new Map<string, number>()
  standardCosts.set(producedPartId, 12_500)
  componentPartIds.forEach((partId, index) => {
    standardCosts.set(partId, 1_000 * (index + 1))
  })
  for (const [partId, standardCost] of standardCosts) {
    await freezeStandardCost(org.id, partId, standardCost)
  }

  return {
    organizationId: org.id,
    userId: user.id,
    buildDefId,
    partDefId,
    subpartDefId,
    movementDefId,
    producedPartId,
    componentPartIds,
    standardCosts,
    qtyPerUnit,
  }
}

/**
 * Write the four `part_standard_*` numbers and the effective date directly.
 *
 * `readStandardCost` omits a part with no `part_standard_cost` rather than
 * defaulting it to zero, and `completeBuild` refuses a plan with any such part,
 * so a fixture that skipped this would abort before writing anything and every
 * assertion below it would be vacuous.
 */
export async function freezeStandardCost(
  organizationId: string,
  partId: string,
  standardCost: number
): Promise<void> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'part_standard_material_cost',
      'part_standard_labor_cost',
      'part_standard_overhead_cost',
      'part_standard_cost',
      'part_standard_cost_effective_at',
    ] as const)

  const partDefId = fields.part_standard_cost?.entityDefinitionId
  if (!fields.part_standard_cost || !partDefId) {
    throw new Error('fixture: part_standard_cost was not seeded')
  }

  const now = new Date()
  const numeric: Array<[{ id: string } | null, number]> = [
    [fields.part_standard_material_cost, standardCost],
    [fields.part_standard_labor_cost, 0],
    [fields.part_standard_overhead_cost, 0],
    [fields.part_standard_cost, standardCost],
  ]

  for (const [field, value] of numeric) {
    if (!field) continue
    await db().insert(schema.FieldValue).values({
      organizationId,
      entityId: partId,
      entityDefinitionId: partDefId,
      fieldId: field.id,
      valueNumber: value,
      updatedAt: now,
    })
  }

  if (fields.part_standard_cost_effective_at) {
    await db().insert(schema.FieldValue).values({
      organizationId,
      entityId: partId,
      entityDefinitionId: partDefId,
      fieldId: fields.part_standard_cost_effective_at.id,
      valueDate: now.toISOString(),
      updatedAt: now,
    })
  }
}

/** Every `stock_movement` instance in the org — archived rows included, on purpose. */
export async function listMovementInstanceIds(
  organizationId: string,
  movementDefId: string
): Promise<string[]> {
  const rows = await db()
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, movementDefId)
      )
    )
  return rows.map((row) => row.id)
}
