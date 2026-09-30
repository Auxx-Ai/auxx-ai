// packages/lib/src/inventory/builds/__tests__/support/build-fixture.ts
//
// A real, DB-backed organization the build paths run against end to end: the `part` and
// `subpart` defs and fields from the seeder passes `EntitySeeder` runs, parts and BOM edges
// written through `UnifiedCrudHandler`, builds inserted into the `Build` table. The frozen
// standard cost is written as raw `FieldValue` rows because `rollStandardCost` is its only writer.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { getOrgCache } from '../../../../cache'
import { UnifiedCrudHandler } from '../../../../resources/crud/unified-handler'
import { PartKind } from '../../../../resources/registry/enum-values'
import { toRecordId } from '../../../../resources/resource-id'
import { createEntityDefinitions } from '../../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../../seed/entity-seeder/create-fields'
import { linkDisplayFields } from '../../../../seed/entity-seeder/link-display-fields'
import { linkRelationships } from '../../../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../../../seed/entity-seeder/types'
import { readBuild } from '../../build-queries'
import { insertBuild, type NewBuild } from '../../build-writes'
import type { BuildRecord } from '../../types'

const db = () => getTestDb() as unknown as Database

/** The defs whose registry fields every build path reads. */
const BUILD_ENTITY_TYPES = ['part', 'subpart'] as const

/** Everything the build tests need to address the seeded org. */
export interface BuildFixture {
  organizationId: string
  userId: string
  partDefId: string
  subpartDefId: string
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
  /** Further defs whose registry fields to materialise, e.g. `['order']`. */
  entityTypes?: string[]
}

/**
 * Seed an organization whose `part` and `subpart` definitions and fields are the registry's own,
 * then give it one buildable finished good with a priced bill of materials.
 */
export async function seedBuildOrg(options: SeedBuildOrgOptions = {}): Promise<BuildFixture> {
  const componentCount = options.components ?? 3

  const org = await createTestOrganization()
  const user = await createTestUser({ name: 'Build Operator' })
  await db()
    .update(schema.Organization)
    .set({ systemUserId: user.id })
    .where(eq(schema.Organization.id, org.id))

  // Every definition (the caches read the whole org), but fields only for the defs a test reads:
  // materialising all ~1,000 registry fields makes the fixture ten times slower.
  const entityDefMap = await createEntityDefinitions(db(), org.id)
  const buildDefMap: EntityDefMap = new Map()
  for (const entityType of [...BUILD_ENTITY_TYPES, ...(options.entityTypes ?? [])]) {
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

  const partDefId = defId('part')
  const subpartDefId = defId('subpart')

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
    partDefId,
    subpartDefId,
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

/** Every `StockMovement` id in the org. */
export async function listMovementIds(organizationId: string): Promise<string[]> {
  const rows = await db()
    .select({ id: schema.StockMovement.id })
    .from(schema.StockMovement)
    .where(eq(schema.StockMovement.organizationId, organizationId))
  return rows.map((row) => row.id)
}

/** A `planned` manual build of the fixture's finished good, numbered like a real one. */
export async function insertTestBuild(
  f: Pick<BuildFixture, 'organizationId' | 'userId' | 'producedPartId'>,
  overrides: Partial<NewBuild> = {}
): Promise<BuildRecord> {
  return insertBuild(db(), f.organizationId, f.userId, {
    partId: f.producedPartId,
    quantityPlanned: 1,
    ...overrides,
  })
}

/** One build of the fixture's org, or `undefined`. */
export async function readTestBuild(
  f: Pick<BuildFixture, 'organizationId'>,
  buildId: string
): Promise<BuildRecord | undefined> {
  return readBuild(db(), f.organizationId, buildId)
}
