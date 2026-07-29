// packages/lib/src/seed/entity-migrations/migrations/059-personal-inbox-def.int.test.ts
//
// DB-backed behavior tests (vitest.integration.config.ts → auxx_test) for entity migration 059,
// the container half of plan 40 phase 1: the `personal_inbox` EntityDefinition and its seven
// CustomField rows, materialized for every existing org.
//
// These have to hit real SQL. The claims worth making are all about persisted rows —
// "seven CustomFields exist, keyed to the NEW def", "a FieldValue against them does not
// FK-violate", "re-running creates nothing" — and none of them survive a mocked database.

import { type Database, schema } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { INBOX_FIELDS } from '../../../resources/registry/resources/inbox-fields'
import { PERSONAL_INBOX_FIELDS } from '../../../resources/registry/resources/personal-inbox-fields'
import { ALL_ENTITY_MIGRATIONS } from '../index'
import { migration059PersonalInboxDef } from './059-personal-inbox-def'

const db = () => getTestDb() as unknown as Database

/** The seven attributes 059 must materialize, sorted for stable comparison. */
const EXPECTED_ATTRS = [
  'created_by_id',
  'inbox_color',
  'inbox_description',
  'inbox_name',
  'inbox_owner_user_id',
  'inbox_settings',
  'inbox_status',
]

/**
 * The two `inbox` system fields plan 40 phase 4 deleted from `INBOX_FIELDS`
 * (entity migration 062 drops the rows). Frozen here so this test can still
 * seed a PRE-phase-4 org — which is the whole point of the "059 omits them"
 * case below: 059 must leave the shared def's copies alone.
 *
 * Only the columns `seedInboxDef` writes are needed.
 */
const RETIRED_INBOX_FIELDS = [
  {
    label: 'Default Access',
    fieldType: FieldType.SINGLE_SELECT,
    systemAttribute: 'inbox_default_lens',
    systemSortOrder: 'a5a',
  },
  {
    label: 'Personal',
    fieldType: FieldType.CHECKBOX,
    systemAttribute: 'inbox_is_personal',
    systemSortOrder: 'a5b',
  },
] as const

/** Seed an `inbox` EntityDefinition plus the named subset of its system fields. */
async function seedInboxDef(orgId: string, attrs: string[]): Promise<string> {
  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: orgId,
      entityType: 'inbox',
      apiSlug: 'inboxes',
      singular: 'Inbox',
      plural: 'Inboxes',
      icon: 'inbox',
      color: 'indigo',
      isVisible: false,
      updatedAt: new Date(),
    })
    .returning()
  if (!def) throw new Error('failed to seed inbox EntityDefinition')

  const seedable = [...Object.values(INBOX_FIELDS), ...RETIRED_INBOX_FIELDS]
  for (const field of seedable) {
    if (!field.systemAttribute || !attrs.includes(field.systemAttribute)) continue
    await db()
      .insert(schema.CustomField)
      .values({
        organizationId: orgId,
        entityDefinitionId: def.id,
        modelType: 'inbox',
        name: field.label,
        type: field.fieldType!,
        systemAttribute: field.systemAttribute as never,
        sortOrder: field.systemSortOrder ?? 'a0',
        isCustom: false,
        updatedAt: new Date(),
      })
  }
  return def.id
}

async function personalInboxDef(orgId: string) {
  const [def] = await db()
    .select()
    .from(schema.EntityDefinition)
    .where(
      and(
        eq(schema.EntityDefinition.organizationId, orgId),
        eq(schema.EntityDefinition.entityType, 'personal_inbox')
      )
    )
  return def
}

async function fieldsOn(defId: string) {
  return db()
    .select({
      id: schema.CustomField.id,
      systemAttribute: schema.CustomField.systemAttribute,
      modelType: schema.CustomField.modelType,
      isCustom: schema.CustomField.isCustom,
      organizationId: schema.CustomField.organizationId,
    })
    .from(schema.CustomField)
    .where(eq(schema.CustomField.entityDefinitionId, defId))
}

async function attrsOn(defId: string): Promise<string[]> {
  return (await fieldsOn(defId)).map((f) => f.systemAttribute as string).sort()
}

describe('migration 059 — personal_inbox def', () => {
  it('is registered in the entity-migration registry under its ledger id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids).toContain('059-personal-inbox-def')
    // Entity migrations reach the ledger via ALL_ENTITY_MIGRATIONS + wrapEntityMigration;
    // only pure-data migrations are listed in data-migrations/registry.ts.
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('creates the def for an org that has none, with the plan-40 identity', async () => {
    const org = await createTestOrganization()
    await seedInboxDef(org.id, EXPECTED_ATTRS)

    const result = await migration059PersonalInboxDef.up(db(), org.id)

    expect(result.alreadyUpToDate).toBe(false)
    expect(result.entityDefsCreated).toBe(1)

    const def = await personalInboxDef(org.id)
    expect(def).toBeDefined()
    expect(def!.apiSlug).toBe('personal-inboxes')
    expect(def!.singular).toBe('Personal Inbox')
    expect(def!.plural).toBe('Personal Inboxes')
    // Mail surfaces render inboxes — the def must never show up in the record sidebar.
    expect(def!.isVisible).toBe(false)
  })

  it('runs per org — two orgs each get their own def and field set', async () => {
    const orgA = await createTestOrganization()
    const orgB = await createTestOrganization()
    await seedInboxDef(orgA.id, EXPECTED_ATTRS)
    await seedInboxDef(orgB.id, EXPECTED_ATTRS)

    await migration059PersonalInboxDef.up(db(), orgA.id)
    await migration059PersonalInboxDef.up(db(), orgB.id)

    const defA = await personalInboxDef(orgA.id)
    const defB = await personalInboxDef(orgB.id)
    expect(defA!.id).not.toBe(defB!.id)

    for (const [org, def] of [
      [orgA, defA],
      [orgB, defB],
    ] as const) {
      const fields = await fieldsOn(def!.id)
      expect(fields).toHaveLength(7)
      expect(fields.every((f) => f.organizationId === org.id)).toBe(true)
    }
  })

  it('materializes exactly the seven expected system attributes', async () => {
    const org = await createTestOrganization()
    await seedInboxDef(org.id, EXPECTED_ATTRS)

    const result = await migration059PersonalInboxDef.up(db(), org.id)
    expect(result.fieldsCreated).toBe(7)

    const def = await personalInboxDef(org.id)
    expect(await attrsOn(def!.id)).toEqual(EXPECTED_ATTRS)

    const fields = await fieldsOn(def!.id)
    // `modelType` carries the def key, so a field row is attributable without a join.
    expect(fields.every((f) => f.modelType === 'personal_inbox')).toBe(true)
    expect(fields.every((f) => f.isCustom === false)).toBe(true)
  })

  it('omits inbox_default_lens and inbox_is_personal — the def is the marker', async () => {
    const org = await createTestOrganization()
    await seedInboxDef(org.id, [...EXPECTED_ATTRS, 'inbox_default_lens', 'inbox_is_personal'])

    await migration059PersonalInboxDef.up(db(), org.id)

    const def = await personalInboxDef(org.id)
    const attrs = await attrsOn(def!.id)
    expect(attrs).not.toContain('inbox_default_lens')
    expect(attrs).not.toContain('inbox_is_personal')
    // …and they are still present on the shared inbox def, which 059 must not touch.
    const inboxDef = await db()
      .select({ id: schema.EntityDefinition.id })
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, org.id),
          eq(schema.EntityDefinition.entityType, 'inbox')
        )
      )
    expect(await attrsOn(inboxDef[0]!.id)).toContain('inbox_is_personal')
  })

  it('links the display fields to the new def’s own field rows', async () => {
    const org = await createTestOrganization()
    const inboxDefId = await seedInboxDef(org.id, EXPECTED_ATTRS)

    await migration059PersonalInboxDef.up(db(), org.id)

    const def = await personalInboxDef(org.id)
    const fields = await fieldsOn(def!.id)
    const byAttr = new Map(fields.map((f) => [f.systemAttribute as string, f.id]))

    expect(def!.primaryDisplayFieldId).toBe(byAttr.get('inbox_name'))
    expect(def!.avatarFieldId).toBe(byAttr.get('inbox_color'))
    expect(def!.secondaryDisplayFieldId).toBeNull()

    // The linked ids belong to the personal_inbox def, never the shared inbox def.
    const inboxFieldIds = new Set((await fieldsOn(inboxDefId)).map((f) => f.id))
    expect(inboxFieldIds.has(def!.primaryDisplayFieldId!)).toBe(false)
  })

  it('accepts a FieldValue against the materialized fields (the FK the backfill exists for)', async () => {
    const org = await createTestOrganization()
    await seedInboxDef(org.id, EXPECTED_ATTRS)
    await migration059PersonalInboxDef.up(db(), org.id)

    const def = await personalInboxDef(org.id)
    const owner = (await fieldsOn(def!.id)).find(
      (f) => f.systemAttribute === 'inbox_owner_user_id'
    )!

    const [instance] = await db()
      .insert(schema.EntityInstance)
      .values({ organizationId: org.id, entityDefinitionId: def!.id, updatedAt: new Date() })
      .returning()

    await expect(
      db().insert(schema.FieldValue).values({
        organizationId: org.id,
        fieldId: owner.id,
        entityId: instance!.id,
        entityDefinitionId: def!.id,
        valueText: org.ownerId,
        updatedAt: new Date(),
      })
    ).resolves.toBeDefined()
  })

  it('is a no-op on the second run — no new def, no new fields, same ids', async () => {
    const org = await createTestOrganization()
    await seedInboxDef(org.id, EXPECTED_ATTRS)

    await migration059PersonalInboxDef.up(db(), org.id)
    const before = await personalInboxDef(org.id)
    const beforeFieldIds = (await fieldsOn(before!.id)).map((f) => f.id).sort()

    const second = await migration059PersonalInboxDef.up(db(), org.id)

    expect(second.alreadyUpToDate).toBe(true)
    expect(second.entityDefsCreated).toBe(0)
    expect(second.fieldsCreated).toBe(0)

    const after = await personalInboxDef(org.id)
    expect(after!.id).toBe(before!.id)
    expect((await fieldsOn(after!.id)).map((f) => f.id).sort()).toEqual(beforeFieldIds)
    expect(after!.primaryDisplayFieldId).toBe(before!.primaryDisplayFieldId)
    expect(after!.avatarFieldId).toBe(before!.avatarFieldId)

    const allDefs = await db()
      .select({ id: schema.EntityDefinition.id })
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, org.id),
          eq(schema.EntityDefinition.entityType, 'personal_inbox')
        )
      )
    expect(allDefs).toHaveLength(1)
  })

  // Dev holds two orgs whose `inbox` def never received the later `inbox_*` backfills.
  // `ensureCustomFields` diffs on `${entityDefinitionId}:${systemAttribute}`, so the new
  // def's field set must be complete regardless — and the gaps on `inbox` must stay gaps.
  it('gives an org with an incomplete inbox field set the full seven anyway', async () => {
    const org = await createTestOrganization()
    const inboxDefId = await seedInboxDef(org.id, ['inbox_name', 'inbox_owner_user_id'])

    const result = await migration059PersonalInboxDef.up(db(), org.id)
    expect(result.fieldsCreated).toBe(7)

    const def = await personalInboxDef(org.id)
    expect(await attrsOn(def!.id)).toEqual(EXPECTED_ATTRS)
    // 059 does not repair the shared inbox def — that is not its job.
    expect(await attrsOn(inboxDefId)).toEqual(['inbox_name', 'inbox_owner_user_id'])
  })

  it('runs for an org with no inbox def at all', async () => {
    const org = await createTestOrganization()

    const result = await migration059PersonalInboxDef.up(db(), org.id)

    expect(result.entityDefsCreated).toBe(1)
    expect(result.fieldsCreated).toBe(7)
    expect(await attrsOn((await personalInboxDef(org.id))!.id)).toEqual(EXPECTED_ATTRS)
  })

  // Phase 1 is behavior-inert: 059 creates a container and nothing else. No instance
  // moves onto the new def, and no view is seeded for it (inbox has none either).
  it('moves no instances and seeds no views', async () => {
    const org = await createTestOrganization()
    const inboxDefId = await seedInboxDef(org.id, EXPECTED_ATTRS)
    const [existing] = await db()
      .insert(schema.EntityInstance)
      .values({ organizationId: org.id, entityDefinitionId: inboxDefId, updatedAt: new Date() })
      .returning()

    await migration059PersonalInboxDef.up(db(), org.id)

    const [stillThere] = await db()
      .select({ entityDefinitionId: schema.EntityInstance.entityDefinitionId })
      .from(schema.EntityInstance)
      .where(eq(schema.EntityInstance.id, existing!.id))
    expect(stillThere!.entityDefinitionId).toBe(inboxDefId)

    const views = await db()
      .select({ id: schema.TableView.id })
      .from(schema.TableView)
      .where(eq(schema.TableView.organizationId, org.id))
    expect(views).toHaveLength(0)
  })

  it('keeps the registry and the materialized set in agreement', () => {
    // Guards the field file against a stray addition: whatever `PERSONAL_INBOX_FIELDS`
    // grows, the materializable subset is what 059 writes.
    const materializable = Object.values(PERSONAL_INBOX_FIELDS)
      .map((f) => f.systemAttribute as string)
      .filter((attr) => !['id', 'created_at', 'updated_at'].includes(attr))
      .sort()
    expect(materializable).toEqual(EXPECTED_ATTRS)
  })
})
