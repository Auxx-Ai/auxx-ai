// packages/lib/src/resources/lookup/__tests__/lookup-entities-by-field-value.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the cache barrel WHOLESALE (partial-mocking it via importOriginal walks
// its real import graph before the mock exists and modules capture the real
// functions — see the field-values test suite note).
vi.mock('../../../cache', () => ({
  getCachedFieldMap: vi.fn(),
}))

const { getCachedFieldMap } = await import('../../../cache')
const { AmbiguousLookupError, buildLookupCondition, lookupEntitiesByFieldValue } = await import(
  '../lookup-entities-by-field-value'
)

const getCachedFieldMapMock = vi.mocked(getCachedFieldMap)

const EMAIL_FIELD = {
  id: 'field-email-1',
  type: 'EMAIL',
  systemAttribute: 'primary_email',
} as never

/**
 * Fake db capturing FieldValue-lane queries. `selectDistinctOn` (the
 * FieldValue query) resolves `rows`; `select` (the RecordIdentity lane)
 * resolves `identityRows`.
 */
function buildFakeDb(
  rows: Array<{
    entityId: string
    displayName: string | null
    secondaryDisplayValue: string | null
    avatarUrl: string | null
  }>,
  identityRows: Array<{
    entityId: string
    displayName: string | null
    secondaryDisplayValue: string | null
    avatarUrl: string | null
  }> = []
) {
  const state = { distinctCalls: 0, selectCalls: 0 }
  const makeChain = (result: unknown[]) => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.innerJoin = () => chain
    chain.where = () => chain
    chain.orderBy = () => chain
    chain.limit = () => Promise.resolve(result)
    return chain
  }
  const db = {
    selectDistinctOn: () => {
      state.distinctCalls++
      return makeChain(rows)
    },
    select: () => {
      state.selectCalls++
      return makeChain(identityRows)
    },
  }
  return { db: db as never, state }
}

const baseParams = {
  organizationId: 'org-1',
  entityDefinitionId: 'def-contact',
  limit: 5,
  // `onAmbiguous` is REQUIRED and has no default, the two real consumers
  // disagree on purpose. Most cases here are single-match, so they take the
  // connector-side policy; the dedicated `onAmbiguous` describe block overrides
  // it to `'error'`.
  onAmbiguous: 'first' as const,
}

beforeEach(() => {
  getCachedFieldMapMock.mockReset()
  getCachedFieldMapMock.mockResolvedValue(new Map([['field-email-1', EMAIL_FIELD]]))
})

describe('lookupEntitiesByFieldValue', () => {
  it('matches by systemAttribute and echoes matchedBy', async () => {
    const { db } = buildFakeDb([
      {
        entityId: 'inst-1',
        displayName: 'Jane',
        secondaryDisplayValue: 'jane@x.com',
        avatarUrl: null,
      },
    ])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      candidates: [{ systemAttribute: 'primary_email', value: 'Jane@X.com' }],
    })
    expect(result.isOk()).toBe(true)
    const { items, hasMore } = result._unsafeUnwrap()
    expect(hasMore).toBe(false)
    expect(items).toHaveLength(1)
    expect(items[0]!.recordId).toBe('def-contact:inst-1')
    expect(items[0]!.matchedBy).toEqual({ systemAttribute: 'primary_email', value: 'Jane@X.com' })
    expect(items[0]!.displayName).toBe('Jane')
  })

  it('resolves { fieldId } candidates through the field map', async () => {
    const { db, state } = buildFakeDb([
      { entityId: 'inst-2', displayName: null, secondaryDisplayValue: null, avatarUrl: null },
    ])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      candidates: [{ fieldId: 'field-email-1' as never, value: 'a@x.com' }],
    })
    expect(result._unsafeUnwrap().items[0]!.recordId).toBe('def-contact:inst-2')
    expect(state.distinctCalls).toBe(1)
  })

  // An unparseable VALUE is data, not a malformed call — nothing in the table can
  // equal it, so the answer is "no matches". This used to return a BadRequestError,
  // which `crud.lookupByField` rethrows; a single Quo contact whose only `match` key
  // was an unparseable phone then killed the entire connector RUN (the slice loop
  // rethrows anything that is not a rate limit or an abort).
  it('returns an EMPTY result when the sole candidate is uncoercible — never errs', async () => {
    const { db, state } = buildFakeDb([])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      candidates: [{ systemAttribute: 'primary_email', value: 'not-an-email' }],
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({ items: [], hasMore: false })
    // Still short-circuits: an uncoercible candidate never reaches the DB.
    expect(state.distinctCalls).toBe(0)
  })

  it('returns an empty result when ALL of several candidates are uncoercible', async () => {
    const { db, state } = buildFakeDb([])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      candidates: [
        { systemAttribute: 'primary_email', value: 'garbage' },
        { systemAttribute: 'primary_email', value: 'also-garbage' },
      ],
    })
    expect(result._unsafeUnwrap().items).toEqual([])
    expect(state.distinctCalls).toBe(0)
  })

  // The whole point of the change: the same garbage input must not be fatal or
  // harmless depending only on how many OTHER candidates the caller passed.
  it('treats a lone uncoercible candidate the same as one beside a valid one', async () => {
    const lone = await lookupEntitiesByFieldValue(buildFakeDb([]).db, {
      ...baseParams,
      candidates: [{ systemAttribute: 'primary_email', value: 'garbage' }],
    })
    const beside = await lookupEntitiesByFieldValue(buildFakeDb([]).db, {
      ...baseParams,
      candidates: [
        { systemAttribute: 'primary_email', value: 'garbage' },
        { systemAttribute: 'primary_email', value: 'ok@x.com' },
      ],
    })
    expect(lone.isOk()).toBe(beside.isOk())
  })

  it('skips invalid candidates but still runs valid ones (best-effort chain)', async () => {
    const { db, state } = buildFakeDb([
      { entityId: 'inst-3', displayName: null, secondaryDisplayValue: null, avatarUrl: null },
    ])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      candidates: [
        { systemAttribute: 'primary_email', value: 'garbage' },
        { systemAttribute: 'primary_email', value: 'ok@x.com' },
      ],
    })
    expect(result._unsafeUnwrap().items).toHaveLength(1)
    expect(state.distinctCalls).toBe(1)
  })

  it('skips a candidate whose field does not exist', async () => {
    const { db, state } = buildFakeDb([])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      candidates: [
        { systemAttribute: 'no_such_field', value: 'x' },
        { systemAttribute: 'primary_email', value: 'ok@x.com' },
      ],
    })
    expect(result.isOk()).toBe(true)
    expect(state.distinctCalls).toBe(1)
  })

  it('dedupes across candidates by recordId (earliest candidate wins attribution)', async () => {
    const { db } = buildFakeDb([
      { entityId: 'inst-1', displayName: null, secondaryDisplayValue: null, avatarUrl: null },
    ])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      candidates: [
        { systemAttribute: 'primary_email', value: 'a@x.com' },
        { systemAttribute: 'primary_email', value: 'b@x.com' },
      ],
    })
    const { items } = result._unsafeUnwrap()
    expect(items).toHaveLength(1)
    expect(items[0]!.matchedBy.value).toBe('a@x.com')
  })

  it('sets hasMore when matches exceed limit', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      entityId: `inst-${i}`,
      displayName: null,
      secondaryDisplayValue: null,
      avatarUrl: null,
    }))
    const { db } = buildFakeDb(rows)
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      limit: 2,
      onAmbiguous: 'first',
      candidates: [{ systemAttribute: 'primary_email', value: 'a@x.com' }],
    })
    const { items, hasMore } = result._unsafeUnwrap()
    expect(items).toHaveLength(2)
    expect(hasMore).toBe(true)
  })

  it('routes external_id candidates through the RecordIdentity lane', async () => {
    const { db, state } = buildFakeDb(
      [],
      [{ entityId: 'inst-9', displayName: 'Ext', secondaryDisplayValue: null, avatarUrl: null }]
    )
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      candidates: [{ systemAttribute: 'external_id', value: 'gmail:jane@x.com' }],
    })
    const { items } = result._unsafeUnwrap()
    expect(items[0]!.recordId).toBe('def-contact:inst-9')
    expect(state.selectCalls).toBe(1)
    expect(state.distinctCalls).toBe(0)
  })

  it('accepts the excludeArchived option (import-planning path)', async () => {
    const { db } = buildFakeDb([
      { entityId: 'inst-1', displayName: null, secondaryDisplayValue: null, avatarUrl: null },
    ])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      excludeArchived: true,
      candidates: [{ systemAttribute: 'primary_email', value: 'a@x.com' }],
    })
    expect(result.isOk()).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Case-insensitive TEXT comparison (opt-in, the CSV importer)
// ─────────────────────────────────────────────────────────────────────────

const TEXT_FIELD = { id: 'field-sku-1', type: 'TEXT', systemAttribute: 'part_sku' } as never

/** Collect every literal SQL fragment out of a built `SQL` object. */
function sqlText(node: unknown): string {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(sqlText).join('')
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if (Array.isArray(obj.queryChunks)) return obj.queryChunks.map(sqlText).join('')
    if (Array.isArray(obj.value)) return obj.value.map(sqlText).join('')
    return ''
  }
  return ''
}

describe('buildLookupCondition, caseInsensitiveText', () => {
  it('is case-SENSITIVE by default (no existing caller moves)', () => {
    const cond = buildLookupCondition(TEXT_FIELD, 'M400L')
    expect(sqlText(cond)).not.toContain('lower(')
  })

  // Direction matters and is pinned on purpose: BOTH sides are lowered, so a
  // `m400l` cell finds a stored `M400L` AND an `M400L` cell finds a stored
  // `m400l`. A one-sided lower() would only work in one direction and would
  // drift silently.
  it('lowers BOTH the column and the value when opted in', () => {
    const cond = buildLookupCondition(TEXT_FIELD, 'M400L', { caseInsensitiveText: true })
    expect(sqlText(cond)).toContain('lower(')
    // The bound parameter carries the LOWER-CASED cell, so the comparison is
    // lower(col) = lower(val) in both directions, not a one-sided lower().
    const dumped = JSON.stringify(cond, (_k, v) => (v instanceof Map ? [...v] : v))
    expect(dumped).toContain('"m400l"')
    expect(dumped).not.toContain('"M400L"')
  })

  // NEVER `ilike`: it reads the right operand as a PATTERN, and `_`/`%` are
  // ordinary characters in a SKU. This comparison decides create-vs-update.
  it('never emits ilike', () => {
    const cond = buildLookupCondition(TEXT_FIELD, 'A_100%', { caseInsensitiveText: true })
    expect(sqlText(cond).toLowerCase()).not.toContain('ilike')
  })

  it('leaves non-text columns alone (numbers have no case)', () => {
    const numberField = { id: 'f-n', type: 'NUMBER', systemAttribute: 'qty' } as never
    const cond = buildLookupCondition(numberField, '42', { caseInsensitiveText: true })
    expect(sqlText(cond)).not.toContain('lower(')
  })
})

// ─────────────────────────────────────────────────────────────────────────
// matchAll (AND), the composite natural key
// ─────────────────────────────────────────────────────────────────────────

/** Fake db for the AND lane: one `select().from().where().orderBy().limit()`. */
function buildAndDb(
  rows: Array<{
    entityId: string
    displayName: string | null
    secondaryDisplayValue: string | null
    avatarUrl: string | null
  }>
) {
  const state = { selectCalls: 0, distinctCalls: 0 }
  const db = {
    select: () => {
      state.selectCalls++
      const chain: Record<string, unknown> = {}
      chain.from = () => chain
      chain.innerJoin = () => chain
      chain.where = () => chain
      chain.orderBy = () => chain
      chain.limit = () => Promise.resolve(rows)
      return chain
    },
    selectDistinctOn: () => {
      state.distinctCalls++
      const chain: Record<string, unknown> = {}
      chain.from = () => chain
      chain.innerJoin = () => chain
      chain.where = () => chain
      chain.orderBy = () => chain
      chain.limit = () => Promise.resolve([])
      return chain
    },
  }
  return { db: db as never, state }
}

describe('lookupEntitiesByFieldValue, matchAll (AND)', () => {
  beforeEach(() => {
    getCachedFieldMapMock.mockResolvedValue(
      new Map([
        ['field-email-1', EMAIL_FIELD],
        ['field-sku-1', TEXT_FIELD],
      ])
    )
  })

  it('intersects in ONE query rather than unioning per-candidate results', async () => {
    const { db, state } = buildAndDb([
      { entityId: 'inst-1', displayName: null, secondaryDisplayValue: null, avatarUrl: null },
    ])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      matchAll: true,
      candidates: [
        { fieldId: 'field-sku-1' as never, value: 'M400L' },
        { fieldId: 'field-email-1' as never, value: 'a@x.com' },
      ],
    })
    const { items } = result._unsafeUnwrap()
    expect(items).toHaveLength(1)
    expect(items[0]!.recordId).toBe('def-contact:inst-1')
    // ONE query for the whole tuple; the per-candidate FieldValue lane is never used.
    expect(state.selectCalls).toBe(1)
    expect(state.distinctCalls).toBe(0)
  })

  // The OR path SKIPS an unusable candidate. Doing that under AND would drop
  // a conjunct and silently WIDEN the match, `(sku AND email)` would degrade
  // to `sku` alone and update the wrong record.
  it('returns EMPTY when any candidate is uncoercible, never skips it', async () => {
    const { db, state } = buildAndDb([
      { entityId: 'inst-1', displayName: null, secondaryDisplayValue: null, avatarUrl: null },
    ])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      matchAll: true,
      candidates: [
        { fieldId: 'field-sku-1' as never, value: 'M400L' },
        { fieldId: 'field-email-1' as never, value: 'not-an-email' },
      ],
    })
    expect(result._unsafeUnwrap()).toEqual({ items: [], hasMore: false })
    expect(state.selectCalls).toBe(0)
  })

  it('returns EMPTY when any candidate names a field that does not exist', async () => {
    const { db, state } = buildAndDb([
      { entityId: 'inst-1', displayName: null, secondaryDisplayValue: null, avatarUrl: null },
    ])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      matchAll: true,
      candidates: [
        { fieldId: 'field-sku-1' as never, value: 'M400L' },
        { systemAttribute: 'no_such_field', value: 'x' },
      ],
    })
    expect(result._unsafeUnwrap().items).toEqual([])
    expect(state.selectCalls).toBe(0)
  })

  it('sets hasMore when the intersection exceeds the limit', async () => {
    const { db } = buildAndDb(
      Array.from({ length: 3 }, (_, i) => ({
        entityId: `inst-${i}`,
        displayName: null,
        secondaryDisplayValue: null,
        avatarUrl: null,
      }))
    )
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      limit: 2,
      onAmbiguous: 'first',
      matchAll: true,
      candidates: [
        { fieldId: 'field-sku-1' as never, value: 'M400L' },
        { fieldId: 'field-email-1' as never, value: 'a@x.com' },
      ],
    })
    const { items, hasMore } = result._unsafeUnwrap()
    expect(items).toHaveLength(2)
    expect(hasMore).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// onAmbiguous
// ─────────────────────────────────────────────────────────────────────────

describe('lookupEntitiesByFieldValue, onAmbiguous', () => {
  const twoRows = [
    { entityId: 'inst-1', displayName: null, secondaryDisplayValue: null, avatarUrl: null },
    { entityId: 'inst-2', displayName: null, secondaryDisplayValue: null, avatarUrl: null },
  ]

  it("absent ⇒ 'first': two matches come back as a list (today's behaviour)", async () => {
    const { db } = buildFakeDb(twoRows)
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      candidates: [{ systemAttribute: 'primary_email', value: 'dup@x.com' }],
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().items).toHaveLength(2)
  })

  it("'error' errs with the match COUNT rather than picking one", async () => {
    const { db } = buildFakeDb(twoRows)
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      limit: 2,
      onAmbiguous: 'error',
      candidates: [{ systemAttribute: 'primary_email', value: 'dup@x.com' }],
    })
    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(AmbiguousLookupError)
    expect((error as InstanceType<typeof AmbiguousLookupError>).matchCount).toBe(2)
  })

  it("'error' is silent on a single match", async () => {
    const { db } = buildFakeDb([twoRows[0]!])
    const result = await lookupEntitiesByFieldValue(db, {
      ...baseParams,
      onAmbiguous: 'error',
      candidates: [{ systemAttribute: 'primary_email', value: 'one@x.com' }],
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().items).toHaveLength(1)
  })
})
