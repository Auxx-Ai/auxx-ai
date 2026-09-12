// packages/lib/src/data-migrations/migrations/152-credit-memo-gl-posting.test.ts
//
// Migration 152 is one INSERT onto a def that already exists, plus a backfill.
// The INSERT is not what silently goes wrong. What does:
//
//  - the id is a permanent ledger key and a reused one is skipped by every
//    database that ran the old migration, with no error;
//  - the migration names its field by KEY, so a registry rename with no rename
//    here provisions nothing while claiming to. It throws on that, and this
//    pins the key so the throw is never the first anyone hears of it;
//  - the field must be TEXT, not a RELATIONSHIP: the `gl_posting` EntityRefKind
//    was removed on 2026-08-28 because GlPosting is a Drizzle table with no
//    EntityDefinition, so a relationship here would not resolve at all;
//  - the BACKFILL is the load-bearing half. §4.2 reads a null stamp as
//    "unposted", so an already-posted memo left unstamped loses its ledger card
//    AND is offered to the next preview for a SECOND posting. Equally, a
//    re-run that rewrote a stamp the poster had already moved would undo it.

import { SYSTEM_ATTRIBUTES } from '@auxx/types/system-attribute'
import { describe, expect, it, vi } from 'vitest'
import type { ResourceField } from '../../resources/registry/field-types'

// `getOrgCache` is a Redis round trip nothing here backs, and `entity-helpers`
// is the database. Both stubbed for the same reason 151's test stubs them:
// `up()` is being driven for its DECISIONS.
const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

/** Entity types the stubbed `loadExistingState` reports the org as holding. */
let existingDefs: string[] = ['credit_memo']
/** Field keys the stubbed `ensureCustomFields` reports as already present. */
let existingFieldKeys: string[] = []
/** Every `ensureCustomFields` call this run made, for the assertions below. */
const ensureCalls: { entityType: string; defId: string; fieldKeys: string[] }[] = []

// Spread the original: `registry.ts` also imports 149, which needs
// `ensureEntityDefinitions`, `linkNewRelationships` and `linkDisplayFields` to
// exist as named exports at import time.
vi.mock('../../seed/entity-helpers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadExistingState: async () => ({
    entityDefs: new Map(
      existingDefs.map((type) => [type, { id: `def_${type}`, entityType: type }])
    ),
    fields: new Map(),
  }),
  ensureCustomFields: async (
    _db: unknown,
    _organizationId: string,
    entityType: string,
    defId: string,
    fields: Record<string, ResourceField>,
    _existing: unknown,
    state: { fieldsCreated: number }
  ) => {
    const fieldKeys = Object.keys(fields)
    ensureCalls.push({ entityType, defId, fieldKeys })
    for (const key of fieldKeys) {
      if (!existingFieldKeys.includes(key)) state.fieldsCreated++
    }
    return new Map()
  },
}))

const { migration152CreditMemoGlPosting, planStamps } = await import('./152-credit-memo-gl-posting')
const { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } = await import('../registry')
const { CREDIT_MEMO_FIELDS } = await import('../../resources/registry/resources/credit-memo-fields')
const { CREDIT_MEMO_GL_POSTING_ATTRIBUTE } = await import('../../money/credit-memo-posting/types')

const MIGRATION_ID = '152-credit-memo-gl-posting'
const ORG = 'org_1'
const FIELD_KEY = 'glPosting'

/** What the fake database below answers with, and what it recorded. */
interface FakeDb {
  /** The `CustomField` row `resolveStampFieldId` finds, if any. */
  stampField: { id: string } | null
  /** `readLivePostedMemos`' answer, newest posting first. */
  postedMemos: { creditMemoId: string; glPostingId: string }[]
  /** Memos that already carry a stamp. */
  alreadyStamped: string[]
  /** Every `FieldValue` row the backfill inserted. */
  inserted: Record<string, unknown>[]
}

/**
 * A database that answers the three reads `up()` makes and records the write.
 *
 * The chains are told apart by how they are entered and ended, which is enough
 * here: `select(...).limit(1)` is the stamp field lookup, `selectDistinct(...)`
 * is the posting read, and a `select(...)` awaited without `limit` is the
 * already-stamped read. Each entry point gets a FRESH chain, because the
 * backfill builds two of them inside one `Promise.all`.
 */
function fakeDb(overrides: Partial<FakeDb> = {}): { db: never; state: FakeDb } {
  const state: FakeDb = {
    stampField: null,
    postedMemos: [],
    alreadyStamped: [],
    inserted: [],
    ...overrides,
  }

  const chain = (rows: () => unknown[]): Record<string, unknown> => {
    const link: Record<string, unknown> = {}
    for (const method of ['from', 'innerJoin', 'where', 'orderBy']) {
      link[method] = () => link
    }
    link.limit = () => (state.stampField ? [state.stampField] : [])
    // A drizzle query builder IS a thenable, awaited with no terminal call.
    // biome-ignore lint/suspicious/noThenProperty: the fake has to be one too.
    link.then = (resolve: (value: unknown) => unknown) => resolve(rows())
    return link
  }

  const db = {
    select: () => chain(() => state.alreadyStamped.map((entityId) => ({ entityId }))),
    selectDistinct: () => chain(() => state.postedMemos),
    insert: () => ({
      values: (rows: Record<string, unknown>[]) => {
        state.inserted.push(...rows)
        // biome-ignore lint/suspicious/noThenProperty: same reason as above.
        return { then: (resolve: (value: unknown) => unknown) => resolve(undefined) }
      },
    }),
  }

  return { db: db as never, state }
}

/** The field-provisioning cases want no backfill in the way. */
function emptyDb(): never {
  return fakeDb().db
}

function resetStubs() {
  existingDefs = ['credit_memo']
  existingFieldKeys = []
  ensureCalls.length = 0
  invalidateAndRecompute.mockClear()
}

describe('migration 152 registration', () => {
  it('is registered exactly once, with the id the module exports', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(migration152CreditMemoGlPosting.id).toBe(MIGRATION_ID)
  })

  it('is the only migration claiming the number 152', () => {
    // 152 is free only because `RETIRED_ID_NUMBERS` stops at 150 and 151 is the
    // last live one. `buildRegistry` throws at module load on a reused id, so
    // this also proves the number was never in the retired range.
    const numbers = ALL_DATA_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(numbers.filter((n) => n === '152')).toHaveLength(1)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('reaches the shared registry without an entry of its own, sorted after 151', () => {
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThan(
      ids.indexOf('151-shipment-label-cost-and-document')
    )
    expect([...ids]).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })
})

describe('what the migration provisions exists in the registry', () => {
  it('glPosting is a credit_memo field carrying credit_memo_gl_posting', () => {
    const field = CREDIT_MEMO_FIELDS[FIELD_KEY]
    expect(field).toBeDefined()
    expect(field?.key).toBe(FIELD_KEY)
    expect(field?.systemAttribute).toBe(CREDIT_MEMO_GL_POSTING_ATTRIBUTE)
    expect(field?.isSystem).toBe(true)
  })

  it('declares a systemAttribute in the shared union', () => {
    expect(SYSTEM_ATTRIBUTES).toContain(CREDIT_MEMO_FIELDS[FIELD_KEY]?.systemAttribute)
  })

  it('is TEXT and NOT a relationship, because GlPosting has no EntityDefinition', () => {
    // The `gl_posting` EntityRefKind was removed on 2026-08-28 for exactly this
    // reason. A RELATIONSHIP here resolves no related def and drops the write.
    expect(CREDIT_MEMO_FIELDS[FIELD_KEY]?.fieldType).toBe('TEXT')
    expect(CREDIT_MEMO_FIELDS[FIELD_KEY]?.type).toBe('string')
    expect(CREDIT_MEMO_FIELDS[FIELD_KEY]?.relationship).toBeUndefined()
    expect(CREDIT_MEMO_FIELDS[FIELD_KEY]?.relationshipConfig).toBeUndefined()
  })

  it('says in its own description why it is not a relationship', () => {
    // The one fact about this column that cannot be recovered from its type.
    expect(CREDIT_MEMO_FIELDS[FIELD_KEY]?.description ?? '').toMatch(/RELATIONSHIP/)
    expect(CREDIT_MEMO_FIELDS[FIELD_KEY]?.description ?? '').toMatch(/EntityDefinition/)
  })

  it('is nullable and writable, because the poster stamps it after the fact', () => {
    // Null is the state of every memo before its entry exists, and the poster
    // writes the stamp in a separate transaction from `postEntry` (§4.4).
    expect(CREDIT_MEMO_FIELDS[FIELD_KEY]?.nullable).toBe(true)
    expect(CREDIT_MEMO_FIELDS[FIELD_KEY]?.capabilities).toMatchObject({
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    })
  })

  it('stays out of the panel, like every other GL backlink', () => {
    expect(CREDIT_MEMO_FIELDS[FIELD_KEY]?.showInPanel).toBe(false)
  })
})

describe('the sort order appends rather than reshuffles', () => {
  it('gives every credit_memo field a distinct sort order', () => {
    const orders = Object.values(CREDIT_MEMO_FIELDS)
      .map((f) => f.systemSortOrder)
      .filter((s): s is string => typeof s === 'string')
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('sorts after every field that already existed, ahead of the common block', () => {
    const previous = Object.entries(CREDIT_MEMO_FIELDS)
      .filter(([key]) => key !== FIELD_KEY)
      // `createdAt` / `updatedAt` / `createdBy` are the trailing common block.
      .filter(([key]) => !['createdAt', 'updatedAt', 'createdBy'].includes(key))
      .map(([, field]) => field.systemSortOrder ?? '')
    const added = CREDIT_MEMO_FIELDS[FIELD_KEY]?.systemSortOrder ?? ''

    for (const existing of previous) {
      expect(added > existing).toBe(true)
    }
    expect(added < (CREDIT_MEMO_FIELDS.createdAt?.systemSortOrder ?? 'b0')).toBe(true)
    expect(added < (CREDIT_MEMO_FIELDS.createdBy?.systemSortOrder ?? 'b2')).toBe(true)
  })
})

describe('planStamps', () => {
  const rows = [
    { creditMemoId: 'cm_1', glPostingId: 'gp_new' },
    { creditMemoId: 'cm_1', glPostingId: 'gp_old' },
    { creditMemoId: 'cm_2', glPostingId: 'gp_2' },
  ]

  it('writes one stamp per memo', () => {
    expect(planStamps(rows, new Set())).toEqual([
      { creditMemoId: 'cm_1', glPostingId: 'gp_new' },
      { creditMemoId: 'cm_2', glPostingId: 'gp_2' },
    ])
  })

  it('takes the NEWEST live posting when a memo has two', () => {
    // The read hands rows back newest-posting-first, matching
    // `listPostingsForSource`'s own ordering, so the stamp names what the
    // ledger card would have shown anyway.
    const plan = planStamps(rows, new Set())
    expect(plan.find((row) => row.creditMemoId === 'cm_1')?.glPostingId).toBe('gp_new')
  })

  it('never touches a memo that already carries a stamp', () => {
    // Idempotency, and more: once the batch poster runs, a memo's stamp names a
    // `credit_memo_batch` posting whose lines this query cannot see. Rewriting
    // on "no per-memo posting found" would silently un-stamp it.
    expect(planStamps(rows, new Set(['cm_1']))).toEqual([
      { creditMemoId: 'cm_2', glPostingId: 'gp_2' },
    ])
    expect(planStamps(rows, new Set(['cm_1', 'cm_2']))).toEqual([])
  })

  it('writes nothing for an org with no postings at all', () => {
    expect(planStamps([], new Set())).toEqual([])
  })
})

describe('migration 152 up()', () => {
  it('skips an org that never got the credit_memo def, touching nothing', async () => {
    resetStubs()
    existingDefs = ['order']

    const result = await migration152CreditMemoGlPosting.up(emptyDb(), ORG)

    expect(result.alreadyUpToDate).toBe(true)
    expect(result.fieldsCreated).toBe(0)
    expect(ensureCalls).toHaveLength(0)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('provisions exactly the one field onto the credit_memo def', async () => {
    resetStubs()

    const result = await migration152CreditMemoGlPosting.up(emptyDb(), ORG)

    expect(ensureCalls).toHaveLength(1)
    expect(ensureCalls[0]?.entityType).toBe('credit_memo')
    expect(ensureCalls[0]?.defId).toBe('def_credit_memo')
    expect(ensureCalls[0]?.fieldKeys).toEqual([FIELD_KEY])
    expect(result.fieldsCreated).toBe(1)
    expect(result.alreadyUpToDate).toBe(false)
    expect(result.entityDefsCreated).toBe(0)
  })

  it('flushes the field caches, because a stale one drops every write', async () => {
    resetStubs()

    await migration152CreditMemoGlPosting.up(emptyDb(), ORG)

    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, ['customFields', 'resources'])
  })

  it('is idempotent: a re-run with nothing to backfill writes and flushes nothing', async () => {
    resetStubs()
    existingFieldKeys = [FIELD_KEY]

    const result = await migration152CreditMemoGlPosting.up(emptyDb(), ORG)

    expect(result.fieldsCreated).toBe(0)
    expect(result.memosBackfilled).toBe(0)
    expect(result.alreadyUpToDate).toBe(true)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('reports the backfilled count on the result it returns', async () => {
    resetStubs()

    const result = await migration152CreditMemoGlPosting.up(emptyDb(), ORG)

    expect(result).toHaveProperty('memosBackfilled')
    expect(result.memosBackfilled).toBe(0)
  })
})

describe('migration 152 backfill', () => {
  const POSTED = [
    { creditMemoId: 'cm_1', glPostingId: 'gp_1' },
    { creditMemoId: 'cm_2', glPostingId: 'gp_2' },
  ]

  it('stamps every already-posted memo in ONE insert', async () => {
    // §4.2 reads a null stamp as unposted, so an already-posted memo left
    // unstamped loses its ledger card AND is offered for a second posting.
    resetStubs()
    const { db, state } = fakeDb({ stampField: { id: 'field_stamp' }, postedMemos: POSTED })

    const result = await migration152CreditMemoGlPosting.up(db, ORG)

    expect(result.memosBackfilled).toBe(2)
    expect(state.inserted).toHaveLength(2)
    expect(state.inserted[0]).toMatchObject({
      organizationId: ORG,
      entityId: 'cm_1',
      entityDefinitionId: 'def_credit_memo',
      fieldId: 'field_stamp',
      valueText: 'gp_1',
    })
    expect(state.inserted[1]).toMatchObject({ entityId: 'cm_2', valueText: 'gp_2' })
  })

  it('flushes the caches when only the backfill changed anything', async () => {
    // The field already existed, so `fieldsCreated` is 0 - but rows moved, and
    // a stale `customFields` entry would drop the next write to them.
    resetStubs()
    existingFieldKeys = [FIELD_KEY]
    const { db } = fakeDb({ stampField: { id: 'field_stamp' }, postedMemos: POSTED })

    const result = await migration152CreditMemoGlPosting.up(db, ORG)

    expect(result.fieldsCreated).toBe(0)
    expect(result.memosBackfilled).toBe(2)
    expect(result.alreadyUpToDate).toBe(false)
    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, ['customFields', 'resources'])
  })

  it('is idempotent: a second run re-reads the stamps and writes nothing', async () => {
    resetStubs()
    existingFieldKeys = [FIELD_KEY]
    const { db, state } = fakeDb({
      stampField: { id: 'field_stamp' },
      postedMemos: POSTED,
      alreadyStamped: ['cm_1', 'cm_2'],
    })

    const result = await migration152CreditMemoGlPosting.up(db, ORG)

    expect(result.memosBackfilled).toBe(0)
    expect(result.alreadyUpToDate).toBe(true)
    expect(state.inserted).toHaveLength(0)
  })

  it('writes nothing when the org has no credit_memo postings', async () => {
    resetStubs()
    existingFieldKeys = [FIELD_KEY]
    const { db, state } = fakeDb({ stampField: { id: 'field_stamp' } })

    const result = await migration152CreditMemoGlPosting.up(db, ORG)

    expect(result.memosBackfilled).toBe(0)
    expect(state.inserted).toHaveLength(0)
  })
})
