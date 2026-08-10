// packages/lib/src/seed/entity-migrations/migrations/074-tag-ai-classify.test.ts
//
// Three things are load-bearing about 074 and all three are pinned here:
//
//  1. **It creates the `tag_ai_classify` CustomField** on the org's tag def — without that
//     row, the first write of the flag is an FK violation, not a clean error (invariant 14).
//  2. **It is idempotent** — the second pass inserts nothing and reports `alreadyUpToDate`,
//     which is also what suppresses the runner's per-org cache recompute.
//  3. **It touches no tag.** No `FieldValue`, no `EntityInstance`, no `UPDATE` of any kind:
//     eligibility must start empty for every org (C10's sibling — nothing may become
//     classifiable because a migration ran), and a value backfill here would silently enrol
//     an org's whole taxonomy.
//
// The global `@auxx/database` mock (`src/test/setup.ts`) stays in place — the migration takes
// its `db` as an argument, so the fake below is passed in rather than mocked over.

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { migration074TagAiClassify } from './074-tag-ai-classify'

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

/** An already-migrated org: the CustomField row 074 would create is already there. */
const existingEligibilityField = {
  id: 'cf_existing',
  systemAttribute: 'tag_ai_classify',
  entityDefinitionId: TAG_DEF_ID,
  options: {},
}

describe('migration 074 — tag_ai_classify', () => {
  it('creates the tag_ai_classify CustomField on the org tag definition', async () => {
    const { db, inserts } = makeDb([[tagDefRow], []])

    const result = await migration074TagAiClassify.up(db, ORG)

    expect(result.fieldsCreated).toBe(1)
    expect(result.alreadyUpToDate).toBe(false)
    expect(inserts).toHaveLength(1)
    expect(inserts[0]?.values).toMatchObject({
      organizationId: ORG,
      entityDefinitionId: TAG_DEF_ID,
      modelType: 'tag',
      systemAttribute: 'tag_ai_classify',
      type: 'CHECKBOX',
      isCustom: false,
    })
  })

  // Re-running is the normal case: the ledger records the migration, but the per-org runner
  // and the admin "run all" button both replay it.
  it('is idempotent — a second pass inserts nothing and reports alreadyUpToDate', async () => {
    const { db, inserts, updates } = makeDb([[tagDefRow], [existingEligibilityField]])

    const result = await migration074TagAiClassify.up(db, ORG)

    expect(result.fieldsCreated).toBe(0)
    expect(result.alreadyUpToDate).toBe(true)
    expect(inserts).toEqual([])
    expect(updates).toEqual([])
  })

  // The whole point of "no value backfill": an existing tag must not become eligible, and
  // nothing about an existing tag may change at all.
  it('never writes a FieldValue or touches an EntityInstance', async () => {
    const { db, inserts, updates } = makeDb([[tagDefRow], []])

    await migration074TagAiClassify.up(db, ORG)

    const { schema } = await import('@auxx/database')
    const insertedTables = inserts.map((i) => i.table)
    expect(insertedTables).toContain(schema.CustomField)
    expect(insertedTables).not.toContain(schema.FieldValue)
    expect(insertedTables).not.toContain(schema.EntityInstance)
    expect(updates).toEqual([])
  })

  it('no-ops for an organization with no tag entity', async () => {
    const { db, inserts } = makeDb([[], []])

    const result = await migration074TagAiClassify.up(db, ORG)

    expect(result).toMatchObject({ fieldsCreated: 0, alreadyUpToDate: true })
    expect(inserts).toEqual([])
  })
})
