// packages/lib/src/seed/entity-migrations/migrations/075-tag-template-key.test.ts
//
// Covers the whole `tag_template_key` data model
// (plans/mail-filter/06-mail-categories-rework-plan.md §3.1 + §3.2), because the field and
// its two guards are one unit: the marker only means anything because the delete guard
// reads it, and it is only safe because nothing but the seeder can write it.
//
//  1. **075 creates the `tag_template_key` CustomField** on the org's tag def — without
//     that row the seeder's first write is an FK violation, not a clean error.
//  2. **075 is idempotent** — a second pass inserts nothing and reports `alreadyUpToDate`,
//     which is also what suppresses the runner's per-org cache recompute.
//  3. **075 stamps no tag.** Deciding WHICH tags become seeded categories is the taxonomy
//     data migration's job (§5) and has rules this migration cannot express; a key written
//     here would make tags undeletable before anything chose them.
//  4. **The delete guard blocks a template tag** and nothing else (§3.2).
//  5. **Nothing but the seeder can write the key** — invariant 2. `capabilities.updatable:
//     false` is not read by the write path, so the drop hook is the actual enforcement.
//
// The global `@auxx/database` mock (`src/test/setup.ts`) stays in place — the migration
// takes its `db` as an argument, so the fake below is passed in rather than mocked over.

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { ForbiddenError } from '../../../errors'
import {
  dropUnauthorizedTemplateKey,
  rejectDeleteIfTemplateTag,
} from '../../../field-hooks/pre/tag-template-guard'
import type { EntityPreDeleteEvent, FieldPreHookEvent } from '../../../field-hooks/types'
import { TAG_FIELDS } from '../../../resources/registry/resources/tag-fields'
import { migration075TagTemplateKey } from './075-tag-template-key'

const ORG = 'org_1'
const TAG_DEF_ID = 'def_tag'

interface Insert {
  table: unknown
  values: Record<string, unknown>
}

interface FakeDb {
  db: Database
  inserts: Insert[]
  updates: unknown[]
}

/**
 * A chainable stand-in that resolves the next queued result set per `await`.
 *
 * `loadExistingState` awaits two selects (EntityDefinitions, then CustomFields — in that
 * order, since `Promise.all` subscribes in array order).
 */
function makeDb(results: unknown[][]): FakeDb {
  const queue = [...results]
  const inserts: Insert[] = []
  const updates: unknown[] = []

  const chain = (): Record<string, unknown> =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(queue.shift() ?? []).then(resolve, reject)
          }
          return () => chain()
        },
      }
    )

  const db = {
    select: () => chain(),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values })
        return { returning: async () => [{ id: 'cf_new', options: values.options ?? {} }] }
      },
    }),
    update: (table: unknown) => {
      updates.push(table)
      return { set: () => ({ where: async () => undefined }) }
    },
  }

  return { db: db as unknown as Database, inserts, updates }
}

const tagDefRow = { id: TAG_DEF_ID, entityType: 'tag' }

/** An already-migrated org: the CustomField row 075 would create is already there. */
const existingTemplateKeyField = {
  id: 'cf_existing',
  systemAttribute: 'tag_template_key',
  entityDefinitionId: TAG_DEF_ID,
  options: {},
}

describe('migration 075 — tag_template_key', () => {
  it('creates the tag_template_key CustomField on the org tag definition', async () => {
    const { db, inserts } = makeDb([[tagDefRow], []])

    const result = await migration075TagTemplateKey.up(db, ORG)

    expect(result.fieldsCreated).toBe(1)
    expect(result.alreadyUpToDate).toBe(false)
    expect(inserts).toHaveLength(1)
    expect(inserts[0]?.values).toMatchObject({
      organizationId: ORG,
      entityDefinitionId: TAG_DEF_ID,
      modelType: 'tag',
      systemAttribute: 'tag_template_key',
      type: 'TEXT',
      isCustom: false,
    })
  })

  // Re-running is the normal case: the ledger records the migration, but the per-org runner
  // and the admin "run all" button both replay it.
  it('is idempotent — a second pass inserts nothing and reports alreadyUpToDate', async () => {
    const { db, inserts, updates } = makeDb([[tagDefRow], [existingTemplateKeyField]])

    const result = await migration075TagTemplateKey.up(db, ORG)

    expect(result.fieldsCreated).toBe(0)
    expect(result.alreadyUpToDate).toBe(true)
    expect(inserts).toEqual([])
    expect(updates).toEqual([])
  })

  // No value backfill: which tags become seeded categories is decided by the taxonomy data
  // migration (§5), and a key written here would make them undeletable before that choice.
  it('never writes a FieldValue or touches an EntityInstance', async () => {
    const { db, inserts, updates } = makeDb([[tagDefRow], []])

    await migration075TagTemplateKey.up(db, ORG)

    const { schema } = await import('@auxx/database')
    const insertedTables = inserts.map((i) => i.table)
    expect(insertedTables).toContain(schema.CustomField)
    expect(insertedTables).not.toContain(schema.FieldValue)
    expect(insertedTables).not.toContain(schema.EntityInstance)
    expect(updates).toEqual([])
  })

  it('no-ops for an organization with no tag entity', async () => {
    const { db, inserts } = makeDb([[], []])

    const result = await migration075TagTemplateKey.up(db, ORG)

    expect(result).toMatchObject({ fieldsCreated: 0, alreadyUpToDate: true })
    expect(inserts).toEqual([])
  })
})

describe('tag_template_key registry field', () => {
  // Invariant 2 in its declarative half. The behavioural half is the drop hook below —
  // these flags are documentation, since the field-value write path never reads them.
  it('is not creatable or updatable by a caller', () => {
    const field = TAG_FIELDS.tag_template_key
    expect(field?.systemAttribute).toBe('tag_template_key')
    expect(field?.capabilities?.creatable).toBe(false)
    expect(field?.capabilities?.updatable).toBe(false)
  })

  // D4/D5 — the marker must freeze nothing. If any of these ever flips to false the
  // classifier loses the one thing this plan exists to give it: a per-business definition.
  it('leaves the editable tag fields editable', () => {
    for (const key of ['title', 'description', 'emoji', 'color', 'tag_parent'] as const) {
      expect(TAG_FIELDS[key]?.capabilities?.updatable).toBe(true)
    }
  })
})

function deleteEvent(values: Record<string, unknown>): EntityPreDeleteEvent {
  return {
    recordId: 'tag:inst_1' as EntityPreDeleteEvent['recordId'],
    entityDefinitionId: TAG_DEF_ID,
    entityType: 'tag',
    entitySlug: 'tags',
    values,
    organizationId: ORG,
    userId: 'user_1',
    bypass: new Set(),
  }
}

describe('rejectDeleteIfTemplateTag', () => {
  it('rejects a delete of a seeded category', async () => {
    await expect(
      rejectDeleteIfTemplateTag(deleteEvent({ tag_template_key: 'category:sales' }))
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('allows a delete of an ordinary tag', async () => {
    await expect(rejectDeleteIfTemplateTag(deleteEvent({}))).resolves.toBeUndefined()
    await expect(
      rejectDeleteIfTemplateTag(deleteEvent({ tag_template_key: null }))
    ).resolves.toBeUndefined()
    // An empty string is not a template identity — it must not make a tag permanent.
    await expect(
      rejectDeleteIfTemplateTag(deleteEvent({ tag_template_key: '' }))
    ).resolves.toBeUndefined()
  })
})

describe('dropUnauthorizedTemplateKey', () => {
  // Invariant 2: a user who can stamp this key makes their own tag undeletable. The hook
  // returns `undefined`, which is the framework's "drop this write" signal.
  it('drops the write instead of persisting a user-supplied key', async () => {
    const event = { newValue: 'category:sales' } as unknown as FieldPreHookEvent
    await expect(dropUnauthorizedTemplateKey(event)).resolves.toBeUndefined()
  })
})
