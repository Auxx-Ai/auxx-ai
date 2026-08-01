// packages/lib/src/field-values/__tests__/batched-realtime-publish.test.ts

import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import { toRecordId } from '@auxx/types/resource'

// ⚠️ Mock '../../realtime/publish-helpers' directly — NOT the '../../realtime'
// barrel. field-value-mutations.ts imports `publishFieldValueUpdates` via the
// barrel, but the barrel re-exports it from this exact file, so mocking the
// leaf module here is enough (and mocking the barrel itself trips an
// import-cycle gotcha elsewhere in the codebase).
vi.mock('../../realtime/publish-helpers', () => ({
  publishFieldValueUpdates: vi.fn(),
}))

// '../../cache' is a large barrel with real DB/Redis-backed providers. Mock
// it wholesale — the only entry points this suite's code path touches are
// `getCachedFieldMap` / `getCachedResource` (called directly by
// field-value-mutations.ts) and `getOrgCache` (called by
// `resolveFieldIds` in field-value-helpers.ts). Nothing else in the org-cache
// surface is reached because every fixture field is non-RELATIONSHIP,
// non-unique, and `ctx.userId` is left `undefined` so the post-hook /
// field-trigger branches (which are `publishEvents`-gated but orthogonal to
// this plan) short-circuit before touching the registry.
vi.mock('../../cache', () => ({
  getCachedFieldMap: vi.fn(),
  getCachedResource: vi.fn(),
  getOrgCache: vi.fn(),
}))

import { getCachedFieldMap, getCachedResource, getOrgCache } from '../../cache'
import { publishFieldValueUpdates } from '../../realtime/publish-helpers'
import { createFieldValueContext, type FieldValueContext } from '../field-value-helpers'
import { buildPublishEntry, setValuesForEntity } from '../field-value-mutations'

const mockedGetCachedFieldMap = getCachedFieldMap as unknown as ReturnType<typeof vi.fn>
const mockedGetCachedResource = getCachedResource as unknown as ReturnType<typeof vi.fn>
const mockedGetOrgCache = getOrgCache as unknown as ReturnType<typeof vi.fn>
// `vi.mocked` (rather than a cast to a bare `Mock`) keeps the real parameter
// tuple, so the recorded `entries` below destructure as `FieldValueUpdateEntry[]`
// instead of `any`.
const mockedPublish = vi.mocked(publishFieldValueUpdates)

// =============================================================================
// buildPublishEntry — pure shaping helper, unit-tested directly.
// =============================================================================

describe('buildPublishEntry', () => {
  const publishRecordId = toRecordId('widget', 'inst-1')
  const key = buildFieldValueKey(publishRecordId, 'field-a' as FieldId)

  const textValue = { id: 'v1', type: 'text', value: 'hello' } as any
  const optionValueA = { id: 'v2', type: 'option', optionId: 'opt-a' } as any
  const optionValueB = { id: 'v3', type: 'option', optionId: 'opt-b' } as any

  it('publishes the raw values array for an array-return field type (TAGS)', () => {
    const field = { type: 'TAGS', options: {} } as any
    const entry = buildPublishEntry({
      publishRecordId,
      fieldId: 'field-a' as FieldId,
      field,
      values: [optionValueA, optionValueB],
    })
    expect(entry).toEqual({ key, value: [optionValueA, optionValueB] })
  })

  it('publishes an empty array (not null) when an array-return field is cleared', () => {
    const field = { type: 'TAGS', options: {} } as any
    const entry = buildPublishEntry({
      publishRecordId,
      fieldId: 'field-a' as FieldId,
      field,
      values: [],
    })
    expect(entry).toEqual({ key, value: [] })
  })

  it('publishes the first value for a scalar field type (TEXT)', () => {
    const field = { type: 'TEXT', options: {} } as any
    const entry = buildPublishEntry({
      publishRecordId,
      fieldId: 'field-a' as FieldId,
      field,
      values: [textValue],
    })
    expect(entry).toEqual({ key, value: textValue })
  })

  it('publishes null (not an empty array) when a scalar field is cleared', () => {
    const field = { type: 'TEXT', options: {} } as any
    const entry = buildPublishEntry({
      publishRecordId,
      fieldId: 'field-a' as FieldId,
      field,
      values: [],
    })
    expect(entry).toEqual({ key, value: null })
  })

  it('treats a scalar field flagged options.multi as array-return', () => {
    const field = { type: 'NUMBER', options: { multi: true } } as any
    const entry = buildPublishEntry({
      publishRecordId,
      fieldId: 'field-a' as FieldId,
      field,
      values: [],
    })
    expect(entry).toEqual({ key, value: [] })
  })

  it('falls back to scalar shaping when field is undefined (e.g. bulk cache miss)', () => {
    const entry = buildPublishEntry({
      publishRecordId,
      fieldId: 'field-a' as FieldId,
      field: undefined,
      values: [textValue],
    })
    expect(entry).toEqual({ key, value: textValue })
  })

  it('builds the key from the caller-resolved publishRecordId, not a raw recordId', () => {
    // Simulates the alias-form guard: caller already swapped an alias-form
    // recordId ('quote:<inst>') for the field's real EntityDefinition id
    // before calling the helper.
    const aliasResolvedId = toRecordId('line_item', 'inst-2')
    const field = { type: 'TEXT', options: {} } as any
    const entry = buildPublishEntry({
      publishRecordId: aliasResolvedId,
      fieldId: 'field-a' as FieldId,
      field,
      values: [textValue],
    })
    expect(entry.key).toBe(buildFieldValueKey(aliasResolvedId, 'field-a' as FieldId))
  })
})

// =============================================================================
// setValuesForEntity — collector wiring (narrower integration-style test).
//
// Drives the real setValuesForEntity → setValueWithBuiltIn → setValueWithType
// code under test end to end for non-RELATIONSHIP, non-unique custom fields,
// with a hand-rolled chainable `ctx.db` fake (Drizzle's `schema.*` column
// refs are undefined under this repo's vitest setup — see project memory —
// so no assertion here depends on them; the fake db ignores its `where()`
// arguments entirely and just records what `.values()` was called with).
// =============================================================================

function makeFakeDb() {
  let idSeq = 0
  let pendingValues: any[] = []
  const chain: any = {}
  Object.assign(chain, {
    delete: () => chain,
    where: () => chain,
    insert: () => chain,
    values: (rows: any) => {
      pendingValues = Array.isArray(rows) ? rows : [rows]
      return chain
    },
    onConflictDoUpdate: () => chain,
    returning: () =>
      Promise.resolve(
        pendingValues.map((row) => ({
          id: `fv-${idSeq++}`,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          ...row,
        }))
      ),
    select: () => chain,
    from: () => chain,
    orderBy: () => Promise.resolve([]),
    update: () => chain,
    set: () => chain,
  })
  return chain
}

/** Minimal CustomField-shaped fixture. `entityDefinitionId: null` keeps the
 *  per-field `publishRecordId` alias guard a no-op (`publishRecordId === recordId`),
 *  which is exercised separately in the `buildPublishEntry` suite above. */
function fieldFixture(id: string, type: string) {
  return {
    id,
    type,
    options: {},
    entityDefinitionId: null,
    entityType: null,
    isUnique: false,
    systemAttribute: null,
  }
}

const FIELD_TEXT = fieldFixture('field-text', 'TEXT')
const FIELD_NUM = fieldFixture('field-num', 'NUMBER')
const FIELD_TAGS = fieldFixture('field-tags', 'TAGS')

const recordId = toRecordId('widget', 'inst-1')

function makeCtx(db: any): FieldValueContext {
  // userId left undefined: the post-hook (`willFirePostHook`) and field-trigger
  // (`publishEvents && ctx.userId`) branches both require a defined userId, so
  // this keeps the exercised path scoped to the write + realtime-collector
  // logic under test without needing to also mock the field-hooks registry.
  return createFieldValueContext('org-1', undefined, db, 'socket-abc')
}

describe('setValuesForEntity realtime batching', () => {
  beforeEach(() => {
    mockedGetCachedFieldMap.mockReset()
    mockedGetCachedResource.mockReset()
    mockedGetOrgCache.mockReset()
    mockedPublish.mockReset()

    mockedGetCachedFieldMap.mockResolvedValue(
      new Map([
        ['field-text', FIELD_TEXT],
        ['field-num', FIELD_NUM],
        ['field-tags', FIELD_TAGS],
      ])
    )
    mockedGetCachedResource.mockResolvedValue(undefined)
    // Real `publishFieldValueUpdates` returns a Promise (the source calls
    // `.catch(() => {})` on it) — the mock must too.
    mockedPublish.mockResolvedValue(undefined)
    // resolveFieldIds only needs `.from(orgId, 'customFields').all()` to
    // resolve (an empty field map means no systemAttribute rewriting
    // happens); `getField`'s cache-miss fallback needs `.byId()` — exercised
    // by the "sibling field throws" test below via a fieldId absent from
    // both this map and the mocked `getCachedFieldMap`.
    mockedGetOrgCache.mockReturnValue({
      from: () => ({ all: async () => ({}), byId: async () => undefined }),
    })
  })

  it('publishes exactly one frame containing all N entries for a multi-field write', async () => {
    const ctx = makeCtx(makeFakeDb())

    const results = await setValuesForEntity(ctx, {
      recordId,
      values: [
        { fieldId: 'field-text', value: 'hello' },
        { fieldId: 'field-num', value: 42 },
        { fieldId: 'field-tags', value: ['a', 'b'] },
      ],
    })

    expect(results.every((r) => r.state === 'complete')).toBe(true)

    expect(mockedPublish).toHaveBeenCalledTimes(1)
    const [, organizationId, entries, options] = mockedPublish.mock.calls[0]!
    expect(organizationId).toBe('org-1')
    expect(options).toEqual({ excludeSocketId: 'socket-abc' })
    expect(entries).toHaveLength(3)

    const byKey = new Map(entries.map((e: any) => [e.key, e]))
    const textKey = buildFieldValueKey(recordId, 'field-text' as FieldId)
    const numKey = buildFieldValueKey(recordId, 'field-num' as FieldId)
    const tagsKey = buildFieldValueKey(recordId, 'field-tags' as FieldId)

    // Scalar fields publish the single TypedFieldValue object (not the raw
    // input), with aiStatus/aiMetadata explicitly cleared on manual writes.
    expect(byKey.get(textKey)).toMatchObject({
      value: { type: 'text', value: 'hello' },
      aiStatus: null,
      aiMetadata: null,
    })
    expect(byKey.get(numKey)).toMatchObject({
      value: { type: 'number', value: 42 },
      aiStatus: null,
      aiMetadata: null,
    })
    // Array-return field publishes the full values array.
    const tagsEntry = byKey.get(tagsKey) as any
    expect(Array.isArray(tagsEntry.value)).toBe(true)
    expect(tagsEntry.value).toHaveLength(2)
    expect(tagsEntry.aiStatus).toBeNull()
  })

  it('produces [] for a cleared array-return field and null for a cleared scalar field', async () => {
    const ctx = makeCtx(makeFakeDb())

    await setValuesForEntity(ctx, {
      recordId,
      values: [
        { fieldId: 'field-text', value: null },
        { fieldId: 'field-tags', value: null },
      ],
    })

    expect(mockedPublish).toHaveBeenCalledTimes(1)
    const [, , entries] = mockedPublish.mock.calls[0]!
    expect(entries).toHaveLength(2)

    const byKey = new Map(entries.map((e: any) => [e.key, e]))
    const textKey = buildFieldValueKey(recordId, 'field-text' as FieldId)
    const tagsKey = buildFieldValueKey(recordId, 'field-tags' as FieldId)

    expect(byKey.get(textKey)?.value).toBeNull()
    expect(byKey.get(tagsKey)?.value).toEqual([])
  })

  it('publishes nothing when publishEvents is false', async () => {
    const ctx = makeCtx(makeFakeDb())

    await setValuesForEntity(ctx, {
      recordId,
      values: [
        { fieldId: 'field-text', value: 'hello' },
        { fieldId: 'field-num', value: 42 },
      ],
      publishEvents: false,
    })

    expect(mockedPublish).not.toHaveBeenCalled()
  })

  it('flushes the entries from fields that succeeded even if a sibling field throws', async () => {
    const ctx = makeCtx(makeFakeDb())
    // Force field-num's write to fail by pointing it at a field the mocked
    // field map doesn't know about — setValueWithBuiltIn's getField() throws
    // "not found" once the raw fieldId misses ctx.fieldCache, which is never
    // warmed for a fieldId absent from the mocked field map.
    mockedGetCachedFieldMap.mockResolvedValue(new Map([['field-text', FIELD_TEXT]]))

    const results = await setValuesForEntity(ctx, {
      recordId,
      values: [
        { fieldId: 'field-text', value: 'hello' },
        { fieldId: 'field-missing', value: 'oops' },
      ],
    })

    const byField = new Map(results.map((r) => [r.fieldId, r]))
    expect(byField.get('field-text')?.state).toBe('complete')
    expect(byField.get('field-missing')?.state).toBe('failed')

    expect(mockedPublish).toHaveBeenCalledTimes(1)
    const [, , entries] = mockedPublish.mock.calls[0]!
    expect(entries).toHaveLength(1)
    expect(entries[0]?.key).toBe(buildFieldValueKey(recordId, 'field-text' as FieldId))
  })
})
