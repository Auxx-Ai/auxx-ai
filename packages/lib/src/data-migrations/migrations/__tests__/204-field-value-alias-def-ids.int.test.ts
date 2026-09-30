// packages/lib/src/data-migrations/migrations/__tests__/204-field-value-alias-def-ids.int.test.ts
// Migration 204 against a real database: alias-stamped rows are repointed, everything else stays.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { migration204FieldValueAliasDefIds } from '../204-field-value-alias-def-ids'

const db = () => getTestDb() as unknown as Database

async function seedDef(organizationId: string, entityType: string) {
  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId,
      entityType,
      apiSlug: `${entityType}s`,
      singular: entityType,
      plural: `${entityType}s`,
      updatedAt: new Date(),
    })
    .returning()
  const [field] = await db()
    .insert(schema.CustomField)
    .values({
      organizationId,
      entityDefinitionId: def!.id,
      modelType: entityType,
      name: 'Total',
      type: 'TEXT',
      sortOrder: 'a0',
      isCustom: false,
      updatedAt: new Date(),
    })
    .returning()
  const [inst] = await db()
    .insert(schema.EntityInstance)
    .values({ organizationId, entityDefinitionId: def!.id, updatedAt: new Date() })
    .returning()
  return { defId: def!.id, fieldId: field!.id, instId: inst!.id }
}

async function insertValue(
  organizationId: string,
  seeded: { fieldId: string; instId: string },
  entityDefinitionId: string
) {
  const [row] = await db()
    .insert(schema.FieldValue)
    .values({
      organizationId,
      entityId: seeded.instId,
      entityDefinitionId,
      fieldId: seeded.fieldId,
      valueText: 'x',
      sortKey: 'a0',
    })
    .returning()
  return row!.id
}

async function defIdOf(id: string): Promise<string | undefined> {
  const [row] = await db()
    .select({ defId: schema.FieldValue.entityDefinitionId })
    .from(schema.FieldValue)
    .where(eq(schema.FieldValue.id, id))
  return row?.defId
}

describe('migration 204: FieldValue alias def ids', () => {
  it('repoints alias-stamped rows and leaves canonical, table-backed and foreign ones alone', async () => {
    const org = await createTestOrganization()
    const quote = await seedDef(org.id, 'quote')
    const thread = await seedDef(org.id, 'thread')
    const invoice = await seedDef(org.id, 'invoice')

    const alias = await insertValue(org.id, quote, 'quote')
    const canonical = await insertValue(org.id, invoice, invoice.defId)
    const tableBacked = await insertValue(org.id, thread, 'thread')

    const other = await createTestOrganization()
    const otherQuote = await seedDef(other.id, 'quote')
    const otherAlias = await insertValue(other.id, otherQuote, 'quote')

    const first = await migration204FieldValueAliasDefIds.up(db(), org.id)
    expect(first).toMatchObject({ alreadyUpToDate: false, fieldValuesRepointed: 1 })

    expect(await defIdOf(alias)).toBe(quote.defId)
    expect(await defIdOf(canonical)).toBe(invoice.defId)
    expect(await defIdOf(tableBacked)).toBe('thread')
    expect(await defIdOf(otherAlias)).toBe('quote')

    const rerun = await migration204FieldValueAliasDefIds.up(db(), org.id)
    expect(rerun).toMatchObject({ alreadyUpToDate: true, fieldValuesRepointed: 0 })
  })
})
