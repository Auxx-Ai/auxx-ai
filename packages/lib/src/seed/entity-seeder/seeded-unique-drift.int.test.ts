// packages/lib/src/seed/entity-seeder/seeded-unique-drift.int.test.ts
//
// DB-backed drift guard (vitest.integration.config.ts -> auxx_test database) for the half of
// the uniqueness contract that lives in the SEEDER rather than in the registry.
//
// `resources/registry/identifier-fields.test.ts` pins the registry-internal invariants
// (unique => isIdentifier, identifier => filterable). It cannot see whether a freshly seeded
// organization actually carries those declarations, and that gap is exactly what went wrong:
// `PART_FIELDS.sku` declared `capabilities.unique: true` from the start, the seeder dropped it
// on the floor until 2026-04-08, and because `create-fields.ts` inserts and never updates, the
// 14 orgs created before that date sat at `isUnique = false` for four months with no test red
// anywhere. Data migration 097 backfilled them; this test is what stops the next one.
//
// Runs Pass 1 + Pass 2 of `EntitySeeder` for a real organization -- the same two functions
// `seedSystemEntities` calls -- and compares every resulting `CustomField.isUnique` against the
// registry declaration it came from. The later passes (relationships, views, dashboards) never
// touch `isUnique`, so they are not needed here.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { ENTITY_INSTANCE_COLUMNS } from './constants'
import { createEntityDefinitions } from './create-entity-defs'
import { createAllFields, FIELD_REGISTRY } from './create-fields'
import { shouldCreateField } from './utils'

const db = () => getTestDb() as unknown as Database

/** `entityType:systemAttribute` -> the registry's `capabilities.unique` answer. */
function expectedUniqueByAttribute(): Map<string, boolean> {
  const expected = new Map<string, boolean>()
  for (const [entityType, fields] of Object.entries(FIELD_REGISTRY)) {
    for (const field of Object.values(fields)) {
      if (!shouldCreateField(field, ENTITY_INSTANCE_COLUMNS)) continue
      expected.set(`${entityType}:${field.systemAttribute}`, field.capabilities.unique === true)
    }
  }
  return expected
}

describe('a freshly seeded org matches the registry on uniqueness', () => {
  let organizationId: string

  beforeEach(async () => {
    const org = await createTestOrganization()
    organizationId = org.id
    const entityDefMap = await createEntityDefinitions(db(), organizationId)
    await createAllFields(db(), organizationId, entityDefMap)
  })

  it('seeds at least one field declared unique, so the assertions below can fail', () => {
    // Without this the parity test passes vacuously the day someone drops the last
    // `capabilities.unique` from the registry -- or the day `FIELD_REGISTRY` stops being
    // exported and this file quietly compares two empty maps.
    const uniqueDeclarations = [...expectedUniqueByAttribute().values()].filter(Boolean)
    expect(uniqueDeclarations.length).toBeGreaterThan(0)
  })

  it('every field declaring capabilities.unique is seeded with isUnique = true', async () => {
    const expected = expectedUniqueByAttribute()

    const rows = await db()
      .select({
        modelType: schema.CustomField.modelType,
        systemAttribute: schema.CustomField.systemAttribute,
        isUnique: schema.CustomField.isUnique,
      })
      .from(schema.CustomField)
      .where(eq(schema.CustomField.organizationId, organizationId))

    const offenders = rows
      .filter((row) => expected.get(`${row.modelType}:${row.systemAttribute}`) === true)
      .filter((row) => row.isUnique !== true)
      .map((row) => `${row.modelType}.${row.systemAttribute}`)

    expect(offenders).toEqual([])
  })

  it('no field is seeded unique that the registry does not declare unique', async () => {
    // The other direction of the same drift. A stray `isUnique = true` is not cosmetic:
    // `checkUniqueValueTyped` carries no entity or relationship scope, so an over-eager flag
    // makes one supplier's part number block another's -- the exact reason
    // `vendor_part.vendorSku` is deliberately NOT unique.
    const expected = expectedUniqueByAttribute()

    const rows = await db()
      .select({
        modelType: schema.CustomField.modelType,
        systemAttribute: schema.CustomField.systemAttribute,
        isUnique: schema.CustomField.isUnique,
      })
      .from(schema.CustomField)
      .where(eq(schema.CustomField.organizationId, organizationId))

    const offenders = rows
      .filter((row) => row.isUnique === true)
      .filter((row) => expected.get(`${row.modelType}:${row.systemAttribute}`) !== true)
      .map((row) => `${row.modelType}.${row.systemAttribute}`)

    expect(offenders).toEqual([])
  })

  it('part.part_sku is seeded unique', async () => {
    // The named case. Migration 097 exists because this row was `false` in half the fleet.
    const [row] = await db()
      .select({ isUnique: schema.CustomField.isUnique })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.systemAttribute, 'part_sku')
        )
      )

    expect(row?.isUnique).toBe(true)
  })
})
