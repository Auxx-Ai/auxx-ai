// packages/lib/src/seed/entity-migrations/migrations/114-retire-gl-posting-defs.test.ts
//
// 114 is a DELETION, which is the one migration shape where a bug is silent in
// both directions: delete too little and every org keeps a def the registry no
// longer describes, delete too much and general-ledger history is gone with no
// way to reconstruct it. So the guard and the scope are both pinned here.

import { type Database, schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { migration114RetireGlPostingDefs } from './114-retire-gl-posting-defs'

/**
 * Minimal awaitable Drizzle double — the `stubDb` shape 108's test uses, cut
 * down to the four calls this migration makes.
 */
function stubDb(rowsByTable: Map<unknown, unknown[]>, writes: string[]): Database {
  const chain = (rows: unknown[]): Record<string, unknown> => ({
    where: () => chain(rows),
    limit: () => chain(rows),
    // A Drizzle query builder IS a thenable — awaiting it is how it runs.
    // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable too
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  })
  const name = (table: unknown) =>
    table === schema.EntityDefinition
      ? 'EntityDefinition'
      : table === schema.CustomField
        ? 'CustomField'
        : table === schema.FieldValue
          ? 'FieldValue'
          : 'unknown'

  return {
    select: () => ({ from: (table: unknown) => chain(rowsByTable.get(table) ?? []) }),
    delete: (table: unknown) => ({
      where: async () => {
        writes.push(`delete ${name(table)}`)
      },
    }),
  } as unknown as Database
}

const GL_DEFS = [
  { id: 'def-gl_posting', entityType: 'gl_posting' },
  { id: 'def-gl_posting_line', entityType: 'gl_posting_line' },
]
/** The def that must survive — see the `gl_account` test below. */
const CHART_DEF = { id: 'def-gl_account', entityType: 'gl_account' }

function orgDb(
  writes: string[],
  opts: { defs?: unknown[]; fields?: unknown[]; instances?: unknown[] } = {}
) {
  return stubDb(
    new Map<unknown, unknown[]>([
      [schema.EntityDefinition, opts.defs ?? [...GL_DEFS, CHART_DEF]],
      [schema.CustomField, opts.fields ?? []],
      [schema.EntityInstance, opts.instances ?? []],
    ]),
    writes
  )
}

describe('migration 114 registration', () => {
  it('is registered exactly once, with a unique id, after 108', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '114-retire-gl-posting-defs')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    // 🛑 Ordering is not cosmetic: 114 deletes what 103 and 108 created. Both
    // have been gutted of that work, so this is a no-op on a fresh database —
    // but on an existing one it must not run before they have.
    expect(ids.indexOf('114-retire-gl-posting-defs')).toBeGreaterThan(ids.indexOf('108-purchasing'))
    expect(migration114RetireGlPostingDefs.id).toBe('114-retire-gl-posting-defs')
  })

  it('is last — a later migration must take 115, not reuse this number', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.at(-1)).toBe('114-retire-gl-posting-defs')
  })

  // 103 was REMOVED from the registry rather than renumbered or emptied: it did
  // nothing but create `gl_posting`, so on a fresh database deleting it is the
  // whole fix. Its `applied` ledger row stays behind and is harmless.
  it('103 is gone from the registry, not merely inert', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids).not.toContain('103-gl-posting')
  })

  // 🛑 114, not 113. The NNN id space is shared across `data-migrations/` and
  // `seed/entity-migrations/`, and 113 was consumed by a transient
  // `113-vendor-bill-balance` that left an `applied` ledger row with no
  // surviving definition. Counting free numbers from the files on disk is not
  // enough — the ledger holds ids no file does.
  it('does not reuse 113', () => {
    expect(migration114RetireGlPostingDefs.id.startsWith('113-')).toBe(false)
  })
})

describe('what it deletes', () => {
  it('removes both defs and their fields, bottom-up', async () => {
    const writes: string[] = []
    const db = orgDb(writes, {
      fields: [
        { id: 'f1', systemAttribute: 'gl_posting_doc_number' },
        { id: 'f2', systemAttribute: 'gl_posting_line_amount' },
      ],
    })

    const result = await migration114RetireGlPostingDefs.up(db, 'org-1')

    // FieldValue before CustomField before EntityDefinition. A left-behind
    // CustomField row is worse than none: the resource registry RETURNS
    // unmatched DB rows, so an orphan surfaces as a nameless custom field.
    expect(writes).toEqual(['delete FieldValue', 'delete CustomField', 'delete EntityDefinition'])
  })

  // 🛑 NOT `alreadyUpToDate`. The runner recomputes `entityDefs` /
  // `entityDefSlugs` / `customFields` / `resources` only for an org whose result
  // says something changed — reporting up-to-date here would leave every reader
  // serving a def that no longer exists.
  it('reports a change so the runner flushes the org cache', async () => {
    const result = await migration114RetireGlPostingDefs.up(orgDb([]), 'org-1')
    expect(result.alreadyUpToDate).toBe(false)
  })

  it('is idempotent — a second pass finds nothing and writes nothing', async () => {
    const writes: string[] = []
    const result = await migration114RetireGlPostingDefs.up(
      orgDb(writes, { defs: [CHART_DEF] }),
      'org-1'
    )
    expect(result.alreadyUpToDate).toBe(true)
    expect(writes).toEqual([])
  })
})

describe('what it must never touch', () => {
  // 🛑 `gl_account` stays an EntityInstance on purpose (G6/P2): `RecordIdentity`
  // is keyed on an instance and has no other addressing mode, and the provider's
  // account id hangs there. It is the reason `gl_account` is in `EntityRefKind`.
  it('leaves gl_account alone even though it is the third GL def', async () => {
    const writes: string[] = []
    await migration114RetireGlPostingDefs.up(orgDb(writes, { defs: [CHART_DEF] }), 'org-1')
    expect(writes).toEqual([])
  })

  // The guard, and it fails CLOSED. A def holding instances is a def somebody
  // began posting to; dropping it would destroy ledger history that nothing can
  // reconstruct. Cheaper to stop the whole migration than to be wrong once.
  it('refuses to drop a def that still holds instances', async () => {
    const writes: string[] = []
    const db = orgDb(writes, { instances: [{ id: 'posting-1' }] })

    await expect(migration114RetireGlPostingDefs.up(db, 'org-1')).rejects.toThrow(
      /refusing to drop the definitions/i
    )
    expect(writes).toEqual([])
  })

  it('names the surviving instances in the error, so the refusal is actionable', async () => {
    const db = orgDb([], { instances: [{ id: 'posting-1' }, { id: 'posting-2' }] })
    await expect(migration114RetireGlPostingDefs.up(db, 'org-1')).rejects.toThrow(
      /posting-1, posting-2/
    )
  })
})
