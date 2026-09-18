// packages/lib/src/data-migrations/migrations/152-credit-memo-gl-posting.test.ts
//
// Migration 152 ran in production and stays for the historical record
// (MIGRATION.md §0b), but the field it provisioned (`glPosting` /
// `credit_memo_gl_posting`) is retired from the registry in step 1b (TARGET
// §1) - a memo's postings are read through `listPostingsForSource` now, never
// a stamp. Migration 168 removes the field from every org that still has it.
//
// So `up()` is now a permanent no-op: `CREDIT_MEMO_FIELDS['glPosting']`
// resolves to nothing, and this pins that it returns `alreadyUpToDate` rather
// than throwing "registry is missing the key" - the throw was right when a
// MISSING key meant a rename nobody updated here; it is wrong now that the key
// is gone ON PURPOSE.
//
// `planStamps` stays under test unchanged - it is a pure function this
// migration no longer reaches, but the record of what it once proved (newest
// live posting wins, an already-stamped memo is never rewritten) is still
// worth keeping.

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

const MIGRATION_ID = '152-credit-memo-gl-posting'
const ORG = 'org_1'
const FIELD_KEY = 'glPosting'

/**
 * `up()` never reaches `db` any more: it returns as soon as the retired
 * registry key resolves to nothing, before the field-provisioning or backfill
 * reads that used to exercise a fake query builder here.
 */
function emptyDb(): never {
  return {} as never
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

describe('the field it provisioned is retired from the registry (step 1b)', () => {
  it('glPosting no longer resolves on CREDIT_MEMO_FIELDS', () => {
    expect(CREDIT_MEMO_FIELDS[FIELD_KEY]).toBeUndefined()
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

describe('migration 152 up() is a permanent no-op now the field is retired', () => {
  it('skips an org that never got the credit_memo def, touching nothing', async () => {
    resetStubs()
    existingDefs = ['order']

    const result = await migration152CreditMemoGlPosting.up(emptyDb(), ORG)

    expect(result.alreadyUpToDate).toBe(true)
    expect(result.fieldsCreated).toBe(0)
    expect(ensureCalls).toHaveLength(0)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('skips an org WITH the credit_memo def too - the key it provisions is gone', async () => {
    // Before step 1b this provisioned `glPosting` and backfilled it. The
    // registry key is retired on purpose, and this is that retirement: not a
    // rename this file failed to follow, so it returns cleanly rather than
    // throwing "registry is missing the key".
    resetStubs()

    const result = await migration152CreditMemoGlPosting.up(emptyDb(), ORG)

    expect(result.alreadyUpToDate).toBe(true)
    expect(result.fieldsCreated).toBe(0)
    expect(result.memosBackfilled).toBe(0)
    expect(ensureCalls).toHaveLength(0)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })
})
