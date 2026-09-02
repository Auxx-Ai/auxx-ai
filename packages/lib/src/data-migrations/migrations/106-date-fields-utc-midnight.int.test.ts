// packages/lib/src/data-migrations/migrations/106-date-fields-utc-midnight.int.test.ts
//
// DB-backed test (vitest.integration.config.ts, auxx_test) for the backfill's
// one rule: a DATE value rounds to the NEAREST UTC midnight. A picker write
// from Pacific time (07:00Z) rounds down, a picker write from Berlin
// (22:00Z the day before) rounds up, and a DATETIME value is an instant that
// the migration must not touch.
//
// Runs against the ephemeral `auxx_test` database only.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { migration106DateFieldsUtcMidnight } from './106-date-fields-utc-midnight'

const db = () => getTestDb() as never as Database

interface Fixture {
  orgId: string
  dealDefId: string
  dateFieldId: string
  datetimeFieldId: string
  dealId: string
}

async function seed(): Promise<Fixture> {
  const org = await createTestOrganization()

  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: org.id,
      entityType: 'deal',
      apiSlug: 'deals',
      singular: 'deal',
      plural: 'deals',
      updatedAt: new Date(),
    })
    .returning()
  const dealDefId = def!.id

  const field = async (name: string, type: string) => {
    const [row] = await db()
      .insert(schema.CustomField)
      .values({
        organizationId: org.id,
        entityDefinitionId: dealDefId,
        modelType: 'deal',
        name,
        type: type as never,
        sortOrder: 'a1',
        isCustom: false,
        updatedAt: new Date(),
      })
      .returning()
    return row!.id
  }

  const dateFieldId = await field('Expected Close', 'DATE')
  const datetimeFieldId = await field('Last Touched', 'DATETIME')

  const [deal] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: org.id,
      entityDefinitionId: dealDefId,
      displayName: 'Deal 1',
      updatedAt: new Date(),
    })
    .returning()

  return { orgId: org.id, dealDefId, dateFieldId, datetimeFieldId, dealId: deal!.id }
}

let f: Fixture

async function dateValue(fieldId: string, valueDate: string, sortKey = 'a'): Promise<string> {
  const [row] = await db()
    .insert(schema.FieldValue)
    .values({
      organizationId: f.orgId,
      entityId: f.dealId,
      entityDefinitionId: f.dealDefId,
      fieldId,
      valueDate,
      sortKey,
      updatedAt: new Date(),
    })
    .returning()
  return row!.id
}

/** The stored instant as canonical ISO, whatever rendering Postgres hands back. */
async function storedIso(fieldValueId: string): Promise<string | null> {
  const [row] = await db()
    .select({ valueDate: schema.FieldValue.valueDate })
    .from(schema.FieldValue)
    .where(eq(schema.FieldValue.id, fieldValueId))
  return row?.valueDate ? new Date(row.valueDate).toISOString() : null
}

beforeEach(async () => {
  f = await seed()
})

describe('migration 106: DATE values round to the nearest UTC midnight', () => {
  it('rounds a Pacific picker write (07:00Z) DOWN to the same day', async () => {
    const id = await dateValue(f.dateFieldId, '2026-05-10T07:00:00.000Z')

    await migration106DateFieldsUtcMidnight.run(db())

    expect(await storedIso(id)).toBe('2026-05-10T00:00:00.000Z')
  })

  it('rounds a Berlin picker write (22:00Z the day before) UP to the picked day', async () => {
    // A UTC+2 user picking May 10 sent local midnight, which is May 9 22:00Z.
    // Truncation would keep May 9; the intended day is May 10.
    const id = await dateValue(f.dateFieldId, '2026-05-09T22:00:00.000Z')

    await migration106DateFieldsUtcMidnight.run(db())

    expect(await storedIso(id)).toBe('2026-05-10T00:00:00.000Z')
  })

  it('leaves a DATETIME value exactly as it was', async () => {
    const id = await dateValue(f.datetimeFieldId, '2026-05-10T07:00:00.000Z')

    await migration106DateFieldsUtcMidnight.run(db())

    expect(await storedIso(id)).toBe('2026-05-10T07:00:00.000Z')
  })

  it('leaves a DATE value already at UTC midnight alone', async () => {
    const id = await dateValue(f.dateFieldId, '2026-05-10T00:00:00.000Z')

    await migration106DateFieldsUtcMidnight.run(db())

    expect(await storedIso(id)).toBe('2026-05-10T00:00:00.000Z')
  })

  it('is idempotent: a second pass changes nothing', async () => {
    const down = await dateValue(f.dateFieldId, '2026-05-10T07:00:00.000Z', 'a')
    const up = await dateValue(f.dateFieldId, '2026-05-09T22:00:00.000Z', 'b')

    await migration106DateFieldsUtcMidnight.run(db())
    await migration106DateFieldsUtcMidnight.run(db())

    expect(await storedIso(down)).toBe('2026-05-10T00:00:00.000Z')
    expect(await storedIso(up)).toBe('2026-05-10T00:00:00.000Z')
  })
})
