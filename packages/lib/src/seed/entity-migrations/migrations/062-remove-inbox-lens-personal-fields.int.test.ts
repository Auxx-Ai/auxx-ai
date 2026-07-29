// packages/lib/src/seed/entity-migrations/migrations/062-remove-inbox-lens-personal-fields.int.test.ts
//
// DB-backed behavior tests (vitest.integration.config.ts → auxx_test) for entity migration 062,
// plan 40 phase 4's retirement of `inbox_default_lens` + `inbox_is_personal`.
//
// These have to hit real SQL. Every claim worth making is about persisted rows — "the two
// CustomFields are gone", "their FieldValue cells went with them", "personal_inbox's seven
// fields were not touched", "a second run writes nothing" — and none of them survive a mocked
// database. The two refusal cases especially: both are about data the migration must REFUSE to
// destroy, and a mock would happily agree with whatever the code did.

import { type Database, schema } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { and, eq, inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { PERSONAL_INBOX_FIELDS } from '../../../resources/registry/resources/personal-inbox-fields'
import { ALL_ENTITY_MIGRATIONS } from '../index'
import { migration062RemoveInboxLensPersonalFields as migration062 } from './062-remove-inbox-lens-personal-fields'

const db = () => getTestDb() as unknown as Database

const PREREQ = '060-personal-inbox-move'

/** Declared on the resource but stored as `EntityInstance` columns, not rows. */
const INSTANCE_COLUMN_ATTRS = new Set(['id', 'created_at'])

/** The two attributes 062 removes. */
const RETIRED = ['inbox_default_lens', 'inbox_is_personal'] as const

/**
 * Everything on the shared `inbox` def, including the two retired attrs — this
 * is a PRE-062 org. Frozen locally: `INBOX_FIELDS` no longer names the retired
 * two, and the survivors must be asserted by name anyway or the test cannot tell
 * "deleted the right two" from "deleted everything".
 */
/** `FieldType` is a const object, not a type — this is its value union. */
type FieldTypeValue = (typeof FieldType)[keyof typeof FieldType]

const INBOX_ATTRS: [attr: string, type: FieldTypeValue][] = [
  ['inbox_name', FieldType.TEXT],
  ['inbox_description', FieldType.RICH_TEXT],
  ['inbox_color', FieldType.TEXT],
  ['inbox_status', FieldType.SINGLE_SELECT],
  ['inbox_default_lens', FieldType.SINGLE_SELECT],
  ['inbox_is_personal', FieldType.CHECKBOX],
  ['inbox_owner_user_id', FieldType.TEXT],
  ['inbox_settings', FieldType.JSON],
  ['created_by_id', FieldType.ACTOR],
]

/**
 * The seven attributes `personal_inbox` MATERIALIZES (059) — none may be
 * touched. `PERSONAL_INBOX_FIELDS` also declares `id` and `created_at`, which
 * are `EntityInstance` COLUMNS rather than `CustomField` rows, so the seeder
 * skips them; asserting the materialized seven by name is the point, and it is
 * what catches a 062 that reached across defs.
 */
const PERSONAL_ATTRS = [
  'created_by_id',
  'inbox_color',
  'inbox_description',
  'inbox_name',
  'inbox_owner_user_id',
  'inbox_settings',
  'inbox_status',
]

async function seedDef(
  orgId: string,
  entityType: 'inbox' | 'personal_inbox',
  attrs: [string, FieldTypeValue][]
): Promise<string> {
  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: orgId,
      entityType,
      apiSlug: entityType === 'inbox' ? 'inboxes' : 'personal-inboxes',
      singular: 'Inbox',
      plural: 'Inboxes',
      icon: 'inbox',
      color: 'indigo',
      isVisible: false,
      updatedAt: new Date(),
    })
    .returning()
  if (!def) throw new Error(`failed to seed ${entityType} EntityDefinition`)

  for (const [attr, type] of attrs) {
    await db()
      .insert(schema.CustomField)
      .values({
        organizationId: orgId,
        entityDefinitionId: def.id,
        modelType: entityType,
        name: attr,
        type,
        systemAttribute: attr as never,
        sortOrder: 'a0',
        isCustom: false,
        updatedAt: new Date(),
      })
  }
  return def.id
}

/** An inbox instance with a value on each named attribute. */
async function seedInstance(
  orgId: string,
  defId: string,
  values: { attr: string; boolean?: boolean; text?: string }[]
): Promise<string> {
  const [instance] = await db()
    .insert(schema.EntityInstance)
    .values({ organizationId: orgId, entityDefinitionId: defId, updatedAt: new Date() })
    .returning()
  if (!instance) throw new Error('failed to seed EntityInstance')

  for (const v of values) {
    const [field] = await db()
      .select({ id: schema.CustomField.id })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.entityDefinitionId, defId),
          eq(schema.CustomField.systemAttribute, v.attr as never)
        )
      )
    if (!field) throw new Error(`no CustomField ${v.attr}`)
    await db()
      .insert(schema.FieldValue)
      .values({
        organizationId: orgId,
        entityId: instance.id,
        entityDefinitionId: defId,
        fieldId: field.id,
        valueBoolean: v.boolean ?? null,
        valueText: v.text ?? null,
        updatedAt: new Date(),
      })
  }
  return instance.id
}

async function attrsOn(defId: string): Promise<string[]> {
  const rows = await db()
    .select({ systemAttribute: schema.CustomField.systemAttribute })
    .from(schema.CustomField)
    .where(eq(schema.CustomField.entityDefinitionId, defId))
  return rows.map((r) => r.systemAttribute as string).sort()
}

async function valueCountFor(defId: string, attrs: readonly string[]): Promise<number> {
  const fields = await db()
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.entityDefinitionId, defId),
        inArray(schema.CustomField.systemAttribute, [...attrs] as never[])
      )
    )
  if (fields.length === 0) return 0
  const rows = await db()
    .select({ id: schema.FieldValue.id })
    .from(schema.FieldValue)
    .where(
      inArray(
        schema.FieldValue.fieldId,
        fields.map((f) => f.id)
      )
    )
  return rows.length
}

/** Mark the prerequisite data migration applied, as a real run would. */
async function markPrerequisiteApplied(status = 'applied'): Promise<void> {
  await db().insert(schema.DataMigration).values({ id: PREREQ, status, updatedAt: new Date() })
}

describe('migration 062 — retire inbox_default_lens + inbox_is_personal', () => {
  it('is registered in the entity-migration registry under its ledger id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids).toContain('062-remove-inbox-lens-personal-fields')
    // Entity migrations reach the ledger via ALL_ENTITY_MIGRATIONS + wrapEntityMigration;
    // only pure-data migrations are listed in data-migrations/registry.ts.
    expect(new Set(ids).size).toBe(ids.length)
    // It must sort after the data migration it depends on.
    expect('062-remove-inbox-lens-personal-fields' > PREREQ).toBe(true)
  })

  describe('with the prerequisite applied', () => {
    beforeEach(async () => {
      await markPrerequisiteApplied()
    })

    it('removes exactly the two retired CustomFields, leaving the other seven', async () => {
      const org = await createTestOrganization()
      const inboxDef = await seedDef(org.id, 'inbox', INBOX_ATTRS)

      const result = await migration062.up(db(), org.id)

      expect(result.alreadyUpToDate).toBe(false)
      const attrs = await attrsOn(inboxDef)
      expect(attrs).not.toContain('inbox_default_lens')
      expect(attrs).not.toContain('inbox_is_personal')
      expect(attrs).toEqual([
        'created_by_id',
        'inbox_color',
        'inbox_description',
        'inbox_name',
        'inbox_owner_user_id',
        'inbox_settings',
        'inbox_status',
      ])
    })

    it('deletes the retired fields’ FieldValue cells and no others', async () => {
      const org = await createTestOrganization()
      const inboxDef = await seedDef(org.id, 'inbox', INBOX_ATTRS)
      await seedInstance(org.id, inboxDef, [
        { attr: 'inbox_name', text: 'Shared Inbox' },
        { attr: 'inbox_default_lens', text: 'subject' },
        // `false`, not `true` — a marker value 060 legitimately leaves behind on a
        // SHARED inbox. The refusal case below covers `true`.
        { attr: 'inbox_is_personal', boolean: false },
        { attr: 'inbox_owner_user_id', text: 'usr_1' },
      ])

      expect(await valueCountFor(inboxDef, RETIRED)).toBe(2)

      await migration062.up(db(), org.id)

      expect(await valueCountFor(inboxDef, RETIRED)).toBe(0)
      // The survivors' cells are untouched — this is the assertion that catches a
      // delete keyed on the instance or the def instead of the two field ids.
      expect(
        await valueCountFor(inboxDef, ['inbox_name', 'inbox_owner_user_id', 'inbox_status'])
      ).toBe(2)
    })

    // Guards the list above against drift: whatever `PERSONAL_INBOX_FIELDS`
    // declares as a materializable system field must be exactly these seven.
    it('asserts against the real PERSONAL_INBOX_FIELDS materializable set', () => {
      const materializable = Object.values(PERSONAL_INBOX_FIELDS)
        .filter((f) => f.systemAttribute && !INSTANCE_COLUMN_ATTRS.has(f.systemAttribute))
        .map((f) => f.systemAttribute as string)
        .sort()
      expect(materializable).toEqual(PERSONAL_ATTRS)
    })

    it('does not touch personal_inbox’s seven fields', async () => {
      const org = await createTestOrganization()
      await seedDef(org.id, 'inbox', INBOX_ATTRS)
      const personalDef = await seedDef(
        org.id,
        'personal_inbox',
        PERSONAL_ATTRS.map((a) => [a, FieldType.TEXT] as [string, FieldTypeValue])
      )

      await migration062.up(db(), org.id)

      expect(await attrsOn(personalDef)).toEqual(PERSONAL_ATTRS)
      expect(await attrsOn(personalDef)).toHaveLength(7)
    })

    // 062 owns the SHARED inbox def and nothing else. A def-blind query scoped
    // only by org would be behaviourally identical today — `personal_inbox` never
    // carries these two attrs (059 omits them by construction) — which is exactly
    // why the scoping needs a test that makes it matter. A stray retired attr on
    // the new def means a botched 059, and that is a data bug to SEE, not one for
    // an unrelated migration to swallow on its way past.
    it('does not reach across defs: a stray retired attr on personal_inbox survives', async () => {
      const org = await createTestOrganization()
      const inboxDef = await seedDef(org.id, 'inbox', INBOX_ATTRS)
      const personalDef = await seedDef(org.id, 'personal_inbox', [
        ['inbox_owner_user_id', FieldType.TEXT],
        ['inbox_default_lens', FieldType.SINGLE_SELECT],
      ])

      await migration062.up(db(), org.id)

      expect(await attrsOn(inboxDef)).not.toContain('inbox_default_lens')
      expect(await attrsOn(personalDef)).toContain('inbox_default_lens')
    })

    it('leaves inbox_owner_user_id on BOTH defs', async () => {
      const org = await createTestOrganization()
      const inboxDef = await seedDef(org.id, 'inbox', INBOX_ATTRS)
      const personalDef = await seedDef(org.id, 'personal_inbox', [
        ['inbox_owner_user_id', FieldType.TEXT],
      ])

      await migration062.up(db(), org.id)

      expect(await attrsOn(inboxDef)).toContain('inbox_owner_user_id')
      expect(await attrsOn(personalDef)).toContain('inbox_owner_user_id')
    })

    it('is a pure no-op on the second run', async () => {
      const org = await createTestOrganization()
      const inboxDef = await seedDef(org.id, 'inbox', INBOX_ATTRS)
      await seedInstance(org.id, inboxDef, [{ attr: 'inbox_name', text: 'Shared Inbox' }])

      const first = await migration062.up(db(), org.id)
      const after = await attrsOn(inboxDef)
      const values = await valueCountFor(inboxDef, ['inbox_name'])

      const second = await migration062.up(db(), org.id)

      expect(first.alreadyUpToDate).toBe(false)
      expect(second.alreadyUpToDate).toBe(true)
      expect(await attrsOn(inboxDef)).toEqual(after)
      expect(await valueCountFor(inboxDef, ['inbox_name'])).toBe(values)
    })

    it('is a no-op for an org with no inbox def at all', async () => {
      const org = await createTestOrganization()
      const result = await migration062.up(db(), org.id)
      expect(result.alreadyUpToDate).toBe(true)
    })

    // Guard 2. An `applied` ledger row is not proof the work landed for THIS org.
    // A surviving `inbox_is_personal = true` is a personal mailbox still on the
    // shared def; dropping the marker would make it org-visible, silently.
    it('REFUSES when an instance still carries inbox_is_personal = true', async () => {
      const org = await createTestOrganization()
      const inboxDef = await seedDef(org.id, 'inbox', INBOX_ATTRS)
      await seedInstance(org.id, inboxDef, [{ attr: 'inbox_is_personal', boolean: true }])

      await expect(migration062.up(db(), org.id)).rejects.toThrow(/still carry inbox_is_personal/)

      // …and nothing was destroyed on the way to the throw.
      expect(await attrsOn(inboxDef)).toContain('inbox_is_personal')
      expect(await attrsOn(inboxDef)).toContain('inbox_default_lens')
      expect(await valueCountFor(inboxDef, RETIRED)).toBe(1)
    })
  })

  // Guard 1. Both retired attrs are INPUTS to 060: the marker tells it which
  // instances to move, and the lens is the source it projects the baseline rows
  // FROM. Dropping either first fails OPEN — restricted inboxes become visible.
  describe('without the prerequisite applied', () => {
    it('REFUSES when the 060 ledger row is absent', async () => {
      const org = await createTestOrganization()
      const inboxDef = await seedDef(org.id, 'inbox', INBOX_ATTRS)

      await expect(migration062.up(db(), org.id)).rejects.toThrow(
        /060-personal-inbox-move has not been applied/
      )
      expect(await attrsOn(inboxDef)).toHaveLength(INBOX_ATTRS.length)
    })

    it('REFUSES when the 060 ledger row is `failed`', async () => {
      const org = await createTestOrganization()
      const inboxDef = await seedDef(org.id, 'inbox', INBOX_ATTRS)
      await markPrerequisiteApplied('failed')

      await expect(migration062.up(db(), org.id)).rejects.toThrow(/ledger status: failed/)
      expect(await attrsOn(inboxDef)).toHaveLength(INBOX_ATTRS.length)
    })

    // Idempotency must not depend on the ledger: an org that already ran 062 in a
    // previous deploy stays a no-op even if the ledger was rebuilt or restored.
    // This is why the "nothing to delete" check sits ABOVE the guards.
    it('stays a no-op for an already-migrated org even with no ledger row', async () => {
      const org = await createTestOrganization()
      const inboxDef = await seedDef(
        org.id,
        'inbox',
        INBOX_ATTRS.filter(([a]) => !RETIRED.includes(a as (typeof RETIRED)[number]))
      )

      const result = await migration062.up(db(), org.id)

      expect(result.alreadyUpToDate).toBe(true)
      expect(await attrsOn(inboxDef)).toHaveLength(7)
    })
  })
})
