// packages/lib/src/field-values/__tests__/email-uniqueness-doors.int.test.ts
//
// DB-backed behavior tests (vitest.integration.config.ts → auxx_test database) for
// org-wide per-value uniqueness on multi-value EMAIL fields at the FieldValueService
// layer — the panel door (`fieldValue.set` → setValueWithBuiltIn) and its siblings
// (addValue / addValues / addValuesBulk).
//
// Why integration and not unit: the regression these tests pin was invisible to
// predicate-blind fake-db unit tests. The seeded contact `primaryEmail` CustomField
// row carries `modelType='contact'` (entity-seeder `create-fields.ts` writes
// `modelType: entityType`), while the old gate derived `getModelType(defId)` →
// `'entity'` for any CUID def — the `eq(CustomField.modelType, …)` predicate then
// emptied the join and the uniqueness check silently PASSED. Only real SQL against
// rows shaped exactly like the seeder's exposes that. The CustomField fixture here
// deliberately mirrors the seeder (modelType 'contact', isUnique true,
// systemAttribute 'primary_email', options.multi).
//
// The org cache barrel is mocked wholesale (deterministic, no Redis): field lookups
// read straight from the test DB.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import type { RecordId } from '@auxx/types/resource'
import { and, asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, UniqueValueConflictError } from '../../errors'
import { createFieldValueContext, type FieldValueContext } from '../field-value-helpers'
import {
  addValue,
  addValues,
  addValuesBulk,
  setBulkValues,
  setValue,
  setValueWithBuiltIn,
} from '../field-value-mutations'

const db = () => getTestDb() as unknown as Database

// ── Org-cache mock (wholesale — DB-backed, no Redis, no providers) ──────────

vi.mock('../../cache', () => {
  const tdb = () => getTestDb() as never as Database

  const fieldsForOrg = async (orgId: string) => {
    return await tdb()
      .select()
      .from(schema.CustomField)
      .where(eq(schema.CustomField.organizationId, orgId))
  }

  const resourceFor = async (orgId: string, defId: string) => {
    const [def] = await tdb()
      .select()
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.id, defId),
          eq(schema.EntityDefinition.organizationId, orgId)
        )
      )
    if (!def) return null
    return {
      id: def.id,
      entityDefinitionId: def.id,
      apiSlug: def.apiSlug,
      entityType: def.entityType,
      display: { primaryDisplayField: null, secondaryDisplayField: null, avatarField: null },
    }
  }

  return {
    getOrgCache: () => ({
      from: (orgId: string, _key: string) => ({
        all: async () => {
          const fields = await fieldsForOrg(orgId)
          const grouped: Record<string, unknown[]> = {}
          for (const f of fields) {
            const defId = f.entityDefinitionId ?? '_'
            grouped[defId] = grouped[defId] ?? []
            grouped[defId]!.push(f)
          }
          return grouped
        },
        byId: async (fieldId: string) => {
          const fields = await fieldsForOrg(orgId)
          return fields.find((f) => f.id === fieldId) ?? null
        },
        bySystemAttribute: async (attr: string) => {
          const fields = await fieldsForOrg(orgId)
          return fields.find((f) => f.systemAttribute === attr) ?? null
        },
      }),
    }),
    getCachedResource: async (orgId: string, defId: string) => resourceFor(orgId, defId),
    findCachedResource: async (orgId: string, defId: string) => resourceFor(orgId, defId),
    getCachedResources: async () => [],
    getCachedFieldMap: async (orgId: string, _defId: string) => {
      const fields = await fieldsForOrg(orgId)
      return new Map(fields.map((f) => [f.id, f]))
    },
    getCachedEntityDefId: async (_orgId: string, slugOrId: string) => slugOrId,
    requireCachedEntityDefId: async (_orgId: string, slugOrId: string) => slugOrId,
    getAllCachedCustomFields: async (orgId: string) => fieldsForOrg(orgId),
    getCachedResourceFields: async () => [],
    getCachedUserInstanceGrants: async () => [],
    getCachedMembersByUserIds: async () => [],
    getCachedAgentsByUserIds: async () => [],
  }
})

// ── Fixtures ────────────────────────────────────────────────────────────────

interface Fixture {
  orgId: string
  defId: string
  emailFieldId: string
  ctx: FieldValueContext
}

/** Mirror of what `EntitySeeder` produces for the contact def + primaryEmail. */
async function seedContactOrg(): Promise<Fixture> {
  const org = await createTestOrganization()
  const orgId = org.id

  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: orgId,
      entityType: 'contact',
      apiSlug: 'contacts',
      singular: 'contact',
      plural: 'contacts',
      updatedAt: new Date(),
    })
    .returning()

  const [emailField] = await db()
    .insert(schema.CustomField)
    .values({
      organizationId: orgId,
      entityDefinitionId: def!.id,
      // Load-bearing: the seeder writes the ENTITY TYPE here, not 'entity'.
      // The old gate filtered on getModelType(defId) === 'entity' and never
      // matched this row — that mismatch IS the uniqueness bypass under test.
      modelType: 'contact',
      name: 'Email',
      type: 'EMAIL',
      systemAttribute: 'primary_email',
      sortOrder: 'a2',
      options: { multi: true },
      isCustom: false,
      isUnique: true,
      updatedAt: new Date(),
    })
    .returning()

  // No userId → field-change post-hooks and trigger publishes stay off.
  const ctx = createFieldValueContext(orgId, undefined, db())
  return { orgId, defId: def!.id, emailFieldId: emailField!.id, ctx }
}

async function seedContact(f: Fixture, displayName: string, emails: string[] = []) {
  const [inst] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: f.orgId,
      entityDefinitionId: f.defId,
      displayName,
      updatedAt: new Date(),
    })
    .returning()

  let sortKey = 'a0'
  for (const email of emails) {
    await db().insert(schema.FieldValue).values({
      organizationId: f.orgId,
      entityId: inst!.id,
      entityDefinitionId: f.defId,
      fieldId: f.emailFieldId,
      valueText: email,
      sortKey,
    })
    sortKey = `${sortKey}V` // strictly ascending fractional-ish keys
  }
  return inst!
}

const recordIdOf = (f: Fixture, instId: string) => `${f.defId}:${instId}` as RecordId

async function emailsOf(f: Fixture, instId: string): Promise<string[]> {
  const rows = await db()
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, instId),
        eq(schema.FieldValue.fieldId, f.emailFieldId),
        eq(schema.FieldValue.organizationId, f.orgId)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))
  return rows.map((r) => r.valueText!).filter((v) => v !== null)
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('multi-value EMAIL uniqueness — service-layer doors', () => {
  let f: Fixture

  beforeEach(async () => {
    f = await seedContactOrg()
  })

  describe('setValueWithBuiltIn (the fieldValue.set panel door)', () => {
    it('rejects a whole-array set containing an email claimed by another contact', async () => {
      const anna = await seedContact(f, 'Anna Multitest', ['anna.work@corp.io', 'anna@example.com'])
      const bob = await seedContact(f, 'Bob', ['bob@example.com'])

      const promise = setValueWithBuiltIn(f.ctx, {
        recordId: recordIdOf(f, bob.id),
        fieldId: f.emailFieldId,
        value: ['bob-new@example.com', 'anna.work@corp.io'],
        publishEvents: false,
      })

      await expect(promise).rejects.toThrow(UniqueValueConflictError)
      await promise.catch((e: UniqueValueConflictError) => {
        expect(e.conflictingValue).toBe('anna.work@corp.io')
        expect(e.existingEntityId).toBe(anna.id)
      })

      // The conflict must abort BEFORE the destructive delete+insert:
      // Bob keeps exactly his prior values.
      expect(await emailsOf(f, bob.id)).toEqual(['bob@example.com'])
      expect(await emailsOf(f, anna.id)).toEqual(['anna.work@corp.io', 'anna@example.com'])
    })

    it('allows a record to re-set (reorder) its OWN values', async () => {
      const anna = await seedContact(f, 'Anna', ['anna.work@corp.io', 'anna@example.com'])

      await setValueWithBuiltIn(f.ctx, {
        recordId: recordIdOf(f, anna.id),
        fieldId: f.emailFieldId,
        value: ['anna@example.com', 'anna.work@corp.io'],
        publishEvents: false,
      })

      expect(await emailsOf(f, anna.id)).toEqual(['anna@example.com', 'anna.work@corp.io'])
    })

    it('does not conflict with emails held only by an ARCHIVED contact', async () => {
      const ghost = await seedContact(f, 'Ghost', ['ghost@example.com'])
      await db()
        .update(schema.EntityInstance)
        .set({ archivedAt: new Date() })
        .where(eq(schema.EntityInstance.id, ghost.id))
      const bob = await seedContact(f, 'Bob')

      await setValueWithBuiltIn(f.ctx, {
        recordId: recordIdOf(f, bob.id),
        fieldId: f.emailFieldId,
        value: ['ghost@example.com'],
        publishEvents: false,
      })

      expect(await emailsOf(f, bob.id)).toEqual(['ghost@example.com'])
    })
  })

  describe('addValue (the fieldValue.add door)', () => {
    it('rejects appending an email claimed by another contact', async () => {
      const anna = await seedContact(f, 'Anna', ['anna.work@corp.io'])
      const bob = await seedContact(f, 'Bob', ['bob@example.com'])

      const promise = addValue(f.ctx, {
        recordId: recordIdOf(f, bob.id),
        fieldId: f.emailFieldId,
        fieldType: 'EMAIL',
        value: { type: 'text', value: 'anna.work@corp.io' },
      })

      await expect(promise).rejects.toThrow(UniqueValueConflictError)
      await promise.catch((e: UniqueValueConflictError) => {
        expect(e.conflictingValue).toBe('anna.work@corp.io')
        expect(e.existingEntityId).toBe(anna.id)
      })
      expect(await emailsOf(f, bob.id)).toEqual(['bob@example.com'])
    })

    it('still appends a fresh email', async () => {
      const bob = await seedContact(f, 'Bob', ['bob@example.com'])
      await addValue(f.ctx, {
        recordId: recordIdOf(f, bob.id),
        fieldId: f.emailFieldId,
        fieldType: 'EMAIL',
        value: { type: 'text', value: 'bob-alt@example.com' },
      })
      expect(await emailsOf(f, bob.id)).toEqual(['bob@example.com', 'bob-alt@example.com'])
    })
  })

  describe('addValues (fieldValue.set mode "add" / applyBulk per-record add)', () => {
    it('rejects a batch containing an email claimed by another contact', async () => {
      await seedContact(f, 'Anna', ['anna.work@corp.io'])
      const bob = await seedContact(f, 'Bob', ['bob@example.com'])

      await expect(
        addValues(f.ctx, {
          recordId: recordIdOf(f, bob.id),
          fieldId: f.emailFieldId,
          values: ['bob-new@example.com', 'anna.work@corp.io'],
          skipPublishEvents: true,
        })
      ).rejects.toThrow(UniqueValueConflictError)

      // Transactional: the fresh sibling value must not have landed either.
      expect(await emailsOf(f, bob.id)).toEqual(['bob@example.com'])
    })

    it('re-adding a record`s own email is a dedup no-op, not a conflict', async () => {
      const anna = await seedContact(f, 'Anna', ['anna.work@corp.io'])
      const result = await addValues(f.ctx, {
        recordId: recordIdOf(f, anna.id),
        fieldId: f.emailFieldId,
        values: ['anna.work@corp.io'],
        skipPublishEvents: true,
      })
      expect(result.map((v) => ('value' in v ? v.value : null))).toEqual(['anna.work@corp.io'])
      expect(await emailsOf(f, anna.id)).toEqual(['anna.work@corp.io'])
    })
  })

  describe('addValuesBulk (applyBulk uniform add)', () => {
    it('rejects when the added email is claimed by a record outside the batch', async () => {
      await seedContact(f, 'Anna', ['anna.work@corp.io'])
      const bob = await seedContact(f, 'Bob')
      const cara = await seedContact(f, 'Cara')

      await expect(
        addValuesBulk(f.ctx, {
          recordIds: [recordIdOf(f, bob.id), recordIdOf(f, cara.id)],
          fieldId: f.emailFieldId,
          values: ['anna.work@corp.io'],
        })
      ).rejects.toThrow(UniqueValueConflictError)

      expect(await emailsOf(f, bob.id)).toEqual([])
      expect(await emailsOf(f, cara.id)).toEqual([])
    })

    it('rejects handing the SAME new email to two records in one batch', async () => {
      const bob = await seedContact(f, 'Bob')
      const cara = await seedContact(f, 'Cara')

      await expect(
        addValuesBulk(f.ctx, {
          recordIds: [recordIdOf(f, bob.id), recordIdOf(f, cara.id)],
          fieldId: f.emailFieldId,
          values: ['fresh@example.com'],
        })
      ).rejects.toThrow(UniqueValueConflictError)

      expect(await emailsOf(f, bob.id)).toEqual([])
      expect(await emailsOf(f, cara.id)).toEqual([])
    })

    it('allows a unique value landing on exactly one record', async () => {
      const bob = await seedContact(f, 'Bob')
      const res = await addValuesBulk(f.ctx, {
        recordIds: [recordIdOf(f, bob.id)],
        fieldId: f.emailFieldId,
        values: ['fresh@example.com'],
      })
      expect(res.inserted).toBe(1)
      expect(await emailsOf(f, bob.id)).toEqual(['fresh@example.com'])
    })
  })

  describe('setValue (low-level service door)', () => {
    it('rejects a whole-array set containing a claimed email', async () => {
      await seedContact(f, 'Anna', ['anna.work@corp.io'])
      const bob = await seedContact(f, 'Bob', ['bob@example.com'])

      await expect(
        setValue(f.ctx, {
          recordId: recordIdOf(f, bob.id),
          fieldId: f.emailFieldId,
          value: ['anna.work@corp.io'],
        })
      ).rejects.toThrow(UniqueValueConflictError)
      expect(await emailsOf(f, bob.id)).toEqual(['bob@example.com'])
    })
  })

  // Intra-batch race gate (query-reduction plan §2e): the uniform bulk
  // fan-out runs its per-record writes concurrently, so the per-pair unique
  // checks all pass before any conflicting row lands. The gate rejects the
  // inherently-invalid shape up front. NOT covered here (out of scope):
  // cross-process races between two separate ops on different connections —
  // there is no DB unique index on the value columns, and adding one is a
  // schema decision for a human.
  describe('setBulkValues (uniform bulk set door)', () => {
    it('rejects assigning a unique value to more than one record', async () => {
      const bob = await seedContact(f, 'Bob', ['bob@example.com'])
      const cara = await seedContact(f, 'Cara', ['cara@example.com'])

      await expect(
        setBulkValues(f.ctx, {
          recordIds: [recordIdOf(f, bob.id), recordIdOf(f, cara.id)],
          values: [{ fieldId: f.emailFieldId, value: ['shared@example.com'] }],
        })
      ).rejects.toThrow(BadRequestError)

      // Rejected before the fan-out: no rows written, prior values intact.
      expect(await emailsOf(f, bob.id)).toEqual(['bob@example.com'])
      expect(await emailsOf(f, cara.id)).toEqual(['cara@example.com'])
    })

    it('allows a unique value on a single-record bulk', async () => {
      const bob = await seedContact(f, 'Bob')
      const res = await setBulkValues(f.ctx, {
        recordIds: [recordIdOf(f, bob.id)],
        values: [{ fieldId: f.emailFieldId, value: ['solo@example.com'] }],
      })
      expect(res.count).toBe(1)
      expect(await emailsOf(f, bob.id)).toEqual(['solo@example.com'])
    })

    it('treats the same record listed twice as ONE record — no false rejection', async () => {
      // One logical record may legitimately hold the unique value; the gate
      // counts DISTINCT instances, not array entries (API/SDK callers do not
      // dedupe their recordIds).
      const bob = await seedContact(f, 'Bob')
      const res = await setBulkValues(f.ctx, {
        recordIds: [recordIdOf(f, bob.id), recordIdOf(f, bob.id)],
        values: [{ fieldId: f.emailFieldId, value: ['dupe@example.com'] }],
      })
      expect(res.count).toBe(2)
      expect(await emailsOf(f, bob.id)).toEqual(['dupe@example.com'])
    })

    it('allows bulk-clearing a unique field across many records', async () => {
      const bob = await seedContact(f, 'Bob', ['bob@example.com'])
      const cara = await seedContact(f, 'Cara', ['cara@example.com'])

      const res = await setBulkValues(f.ctx, {
        recordIds: [recordIdOf(f, bob.id), recordIdOf(f, cara.id)],
        values: [{ fieldId: f.emailFieldId, value: null }],
      })
      expect(res.count).toBe(2)
      expect(await emailsOf(f, bob.id)).toEqual([])
      expect(await emailsOf(f, cara.id)).toEqual([])
    })
  })
})
