// packages/lib/src/field-values/__tests__/name-decomposition.test.ts
//
// NAME composite decomposition at the server chokepoint
// (plans/field-values/name-field-writes.md Phase 1 / §4a–§4d).
//
// A NAME field is a COMPOSITE over two TEXT part fields and owns no storage of
// its own: `setValueWithBuiltIn` fans every set-shaped write out to the two
// parts, so no door — tRPC set/setBulk, the API set-values route, the SDK, the
// importer, `record.create`, workflows, Kopilot, AI commits — can leave a stray
// row on the NAME field again. These tests pin one write per door plus the
// coercion breadth (§4d), the unlinked-field fallback (§4), the NAME-plus-part
// collision rule (§4b) and the return contract (§4c).

import { toRecordId } from '@auxx/types/resource'

// Mock '../../realtime/publish-helpers' directly — NOT the '../../realtime'
// barrel (see batched-realtime-publish.test.ts for the import-cycle rationale).
vi.mock('../../realtime/publish-helpers', () => ({
  publishFieldValueUpdates: vi.fn(),
}))

// '../../cache' is a large barrel with real DB/Redis-backed providers. Mock it
// wholesale; the entry points this suite's code path touches are
// `getCachedFieldMap`/`getCachedResource` (field-value-mutations) and
// `getOrgCache` (resolveFieldIds / getField).
vi.mock('../../cache', () => ({
  getCachedFieldMap: vi.fn(),
  getCachedResource: vi.fn(),
  getOrgCache: vi.fn(),
  getAllCachedCustomFields: vi.fn(async () => []),
  getCachedRecordRules: vi.fn(async () => []),
  // Reached only on the display-recompute path, via `getDisplayFieldDeps`.
  // Empty = this org has no dependent entities, so no cascade.
  getCachedResources: vi.fn(async () => []),
}))

// No post-hooks/pre-hooks: this suite is about WHERE the rows land, not about
// the hook chain (set-idempotency.test.ts owns that).
vi.mock('../../field-hooks/registry', () => ({
  hasEntityFieldChangeHooks: vi.fn(() => false),
  hasFieldTypeChangeHooks: vi.fn(() => false),
  hasFieldPreHooks: vi.fn(() => false),
  getEntityFieldChangeHooks: vi.fn(() => []),
  getFieldTypeChangeHooks: vi.fn(() => []),
  getFieldPreHooks: vi.fn(() => []),
}))

vi.mock('../../field-hooks/collect-triggers', () => ({
  collectTriggeredFields: vi.fn(async () => []),
  deduplicateBySystemAttribute: vi.fn((fields: unknown[]) => fields),
}))
vi.mock('../../field-hooks/publish', () => ({
  publishFieldTriggerEvents: vi.fn(async () => {}),
  publishBatchFieldTriggerEvents: vi.fn(async () => {}),
}))

// The unlinked-NAME fallback must WARN, never throw. Intercept only the
// `field-value-mutations` scope and leave every other scoped logger real (a
// full-replacement mock of a shared module is a footgun here).
const { loggerWarn } = vi.hoisted(() => ({ loggerWarn: vi.fn() }))
vi.mock('@auxx/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@auxx/logger')>()
  return {
    ...actual,
    createScopedLogger: (scope: string) =>
      scope === 'field-value-mutations'
        ? { ...actual.createScopedLogger(scope), warn: loggerWarn }
        : actual.createScopedLogger(scope),
  }
})

// Post-write ownership (one stamp + one searchText rebuild per composite
// write) is counted, not inspected. Both modules are PARTIALLY mocked via
// `importOriginal` — a full replacement of either would strand the rest of the
// write path. `updateSearchText` is spied here rather than at its call sites
// because `field-value-helpers` imports the same module, so this counts EVERY
// rebuild a write triggers, from whichever frame.
const { searchTextSpy, stampSpy } = vi.hoisted(() => ({
  searchTextSpy: vi.fn(async () => {}),
  stampSpy: vi.fn(async () => {}),
}))
vi.mock('../search-text', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../search-text')>()),
  updateSearchText: searchTextSpy,
}))
vi.mock('../field-value-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../field-value-helpers')>()),
  stampEntityInstanceUpdatedAt: stampSpy,
}))

vi.mock('../timeline-snapshot', () => ({
  preloadSnapshotCache: vi.fn(),
  resolveFieldChangeSnapshotPair: vi.fn(async () => ({ oldDisplay: null, newDisplay: null })),
  resolveFieldChangeSnapshotsBulk: vi.fn(async () => new Map()),
}))

import { getCachedFieldMap, getCachedResource, getOrgCache } from '../../cache'
import { publishFieldValueUpdates } from '../../realtime/publish-helpers'
import { createFieldValueContext, type FieldValueContext } from '../field-value-helpers'
import {
  applyBulk,
  setBulkValues,
  setValuesForEntity,
  setValueWithBuiltIn,
} from '../field-value-mutations'

const mockedGetCachedResource = getCachedResource as unknown as ReturnType<typeof vi.fn>
const mockedGetCachedFieldMap = getCachedFieldMap as unknown as ReturnType<typeof vi.fn>
const mockedGetOrgCache = getOrgCache as unknown as ReturnType<typeof vi.fn>
const mockedPublish = vi.mocked(publishFieldValueUpdates)

// =============================================================================
// Fixtures
// =============================================================================

const recordId = toRecordId('widget', 'inst-1')

/** Minimal CustomField-shaped fixture (same shape as the sibling suites). */
function fieldFixture(id: string, type: string, options: Record<string, unknown> = {}) {
  return {
    id,
    type,
    options,
    entityDefinitionId: null,
    entityDefinition: null,
    entityType: null,
    isUnique: false,
    systemAttribute: null,
  }
}

// Part ids are deliberately ordered so the last-name part sorts BEFORE the
// first-name part by fieldId — that is what makes the deterministic
// lock-ordering sort in the decomposition observable.
const FIELD_FIRST = fieldFixture('field-a-first', 'TEXT')
const FIELD_LAST = fieldFixture('field-b-last', 'TEXT')
const FIELD_NAME = fieldFixture('field-z-name', 'NAME', {
  name: { firstNameFieldId: FIELD_FIRST.id, lastNameFieldId: FIELD_LAST.id },
})
const FIELD_NAME_UNLINKED = fieldFixture('field-z-name-unlinked', 'NAME')
const ALL_FIELDS = [FIELD_FIRST, FIELD_LAST, FIELD_NAME, FIELD_NAME_UNLINKED]

/**
 * Chainable `ctx.db` fake. Drizzle's `schema.*` column refs are `{}` under this
 * repo's vitest setup (see project memory), so the fake ignores every `where()`
 * argument: reads always resolve to `existingRows` and writes are recorded in
 * order. Every test here starts from an EMPTY store, so each part write is an
 * INSERT and `insertedRows` is the ordered ledger of what landed where.
 */
function makeFakeDb(existingRows: any[] = []) {
  let idSeq = 0
  let pendingValues: any[] = []
  const state = {
    deleteCalls: 0,
    insertCalls: 0,
    updateCalls: 0,
    insertedRows: [] as any[],
    updatedPayloads: [] as any[],
    /**
     * `select({ valueText })` — the single-column sibling read inside
     * `resolveNameFieldDisplayValue`, and the only projection of that shape
     * anywhere in the package. Counting it is what pins "a decomposed write
     * reads neither part back".
     */
    siblingSelects: 0,
  }
  const chain: any = {}
  Object.assign(chain, {
    delete: () => {
      state.deleteCalls++
      return chain
    },
    where: () => chain,
    insert: () => {
      state.insertCalls++
      return chain
    },
    values: (rows: any) => {
      pendingValues = Array.isArray(rows) ? rows : [rows]
      state.insertedRows.push(...pendingValues)
      return chain
    },
    onConflictDoUpdate: () => chain,
    returning: () =>
      Promise.resolve(
        pendingValues.map((row) => ({
          id: `fv-new-${idSeq++}`,
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
          ...row,
        }))
      ),
    select: (projection?: any) => {
      if (projection && Object.keys(projection).length === 1 && 'valueText' in projection) {
        state.siblingSelects++
      }
      return chain
    },
    from: () => chain,
    orderBy: () => Promise.resolve(existingRows),
    // Terminal for the sibling read; never reached once the decomposition
    // owns the recompute.
    limit: () => Promise.resolve([]),
    update: () => {
      state.updateCalls++
      return chain
    },
    set: (payload: any) => {
      state.updatedPayloads.push(payload)
      return chain
    },
    transaction: async (fn: (tx: any) => Promise<any>) => fn(chain),
    execute: () => Promise.resolve([]),
  })
  return { db: chain, state }
}

/** Context with a REAL userId so the post-hook / field-trigger gates are open. */
function makeCtx(db: any, fields: Array<{ id: string }>): FieldValueContext {
  const ctx = createFieldValueContext('org-1', 'user-1', db, 'socket-abc')
  for (const f of fields) ctx.fieldCache.set(f.id, f as any)
  return ctx
}

/** The (fieldId, valueText) pairs the fake recorded, in write order. */
function writes(state: { insertedRows: any[] }): Array<{ fieldId: string; value: unknown }> {
  return state.insertedRows.map((r) => ({ fieldId: r.fieldId, value: r.valueText }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedGetCachedResource.mockResolvedValue(undefined)
  mockedPublish.mockResolvedValue(undefined)
  mockedGetCachedFieldMap.mockResolvedValue(new Map(ALL_FIELDS.map((f) => [f.id, f])))
  // resolveFieldIds needs `.from(orgId, 'customFields').all()`; getField's
  // cache-miss fallback needs `.byId()` (never hit — fieldCache is pre-warmed).
  mockedGetOrgCache.mockReturnValue({
    from: () => ({ all: async () => ({}), byId: async () => undefined }),
  })
})

// =============================================================================
// Door 1 — direct `setValueWithBuiltIn` (tRPC `fieldValue.set`, API set-values,
// SDK, workflows, Kopilot)
// =============================================================================

describe('NAME decomposition — direct setValueWithBuiltIn', () => {
  it('writes both parts and ZERO rows on the NAME field', async () => {
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, ALL_FIELDS)

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: FIELD_NAME.id,
      value: { firstName: 'Anita', lastName: 'Bicknell' },
    })

    expect(writes(state)).toEqual([
      { fieldId: FIELD_FIRST.id, value: 'Anita' },
      { fieldId: FIELD_LAST.id, value: 'Bicknell' },
    ])
    expect(state.insertedRows.some((r) => r.fieldId === FIELD_NAME.id)).toBe(false)
  })

  it('orders the two part writes by fieldId ascending (deadlock-free lock order)', async () => {
    // The fixture links firstName → 'field-a-first' and lastName →
    // 'field-b-last', so ascending fieldId happens to be first-then-last; flip
    // the link and the write order must flip with it, proving the order comes
    // from the sort and not from the literal order of the two part writes.
    const flipped = fieldFixture('field-z-name-flipped', 'NAME', {
      name: { firstNameFieldId: FIELD_LAST.id, lastNameFieldId: FIELD_FIRST.id },
    })
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, [...ALL_FIELDS, flipped])

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: flipped.id,
      value: { firstName: 'Anita', lastName: 'Bicknell' },
    })

    expect(writes(state)).toEqual([
      // 'field-a-first' now holds the LAST name, and still sorts first.
      { fieldId: FIELD_FIRST.id, value: 'Bicknell' },
      { fieldId: FIELD_LAST.id, value: 'Anita' },
    ])
  })

  it('§4c: returns no values under the NAME fieldId, with an honest `changed`', async () => {
    const { db } = makeFakeDb()
    const ctx = makeCtx(db, ALL_FIELDS)

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: FIELD_NAME.id,
      value: { firstName: 'Anita', lastName: 'Bicknell' },
    })

    expect(result.state).toBe('complete')
    expect(result.values).toEqual([])
    expect(result.changed).toBe(true)
  })

  it('§4c: reports `changed: false` when neither part moved', async () => {
    // B-14: clearing a field with no stored rows is a no-op on BOTH parts, so
    // the composite reports no change and the D-7 stamp upstream stays silent.
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, ALL_FIELDS)

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: FIELD_NAME.id,
      value: null,
    })

    expect(result.values).toEqual([])
    expect(result.changed).toBe(false)
    expect(state.insertCalls).toBe(0)
    expect(state.deleteCalls).toBe(0)
  })
})

// =============================================================================
// §4d — coercion breadth: every shape `nameConverter` accepts today
// =============================================================================

describe('NAME decomposition — input coercion (§4d)', () => {
  it('a bare full-name STRING splits into the two parts', async () => {
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, ALL_FIELDS)

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: FIELD_NAME.id,
      value: 'Anita Bicknell',
    })

    expect(writes(state)).toEqual([
      { fieldId: FIELD_FIRST.id, value: 'Anita' },
      { fieldId: FIELD_LAST.id, value: 'Bicknell' },
    ])
  })

  it('an already-typed `json` value decomposes too', async () => {
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, ALL_FIELDS)

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: FIELD_NAME.id,
      value: { type: 'json', value: { firstName: 'Anita', lastName: 'Bicknell' } },
    })

    expect(writes(state)).toEqual([
      { fieldId: FIELD_FIRST.id, value: 'Anita' },
      { fieldId: FIELD_LAST.id, value: 'Bicknell' },
    ])
  })

  it('null clears BOTH parts', async () => {
    const rows = [
      {
        id: 'fv-first',
        entityId: 'inst-1',
        entityDefinitionId: 'widget',
        fieldId: FIELD_FIRST.id,
        organizationId: 'org-1',
        valueText: 'Anita',
        valueNumber: null,
        valueBoolean: null,
        valueDate: null,
        valueJson: null,
        optionId: null,
        relatedEntityId: null,
        relatedEntityDefinitionId: null,
        actorId: null,
        aiStatus: null,
        sortKey: 'a0',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]
    // The fake ignores `where`, so BOTH part reads see this row — which is
    // exactly what "there is something to clear on each part" needs here.
    const { db, state } = makeFakeDb(rows)
    const ctx = makeCtx(db, ALL_FIELDS)

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: FIELD_NAME.id,
      value: null,
    })

    // One DELETE per part, nothing inserted, and no row on the NAME field.
    expect(state.deleteCalls).toBe(2)
    expect(state.insertCalls).toBe(0)
    expect(result.changed).toBe(true)
  })

  it('a blank string clears both parts (converter maps blank to null)', async () => {
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, ALL_FIELDS)

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: FIELD_NAME.id,
      value: '   ',
    })

    expect(state.insertCalls).toBe(0)
    expect(result.changed).toBe(false)
  })
})

// =============================================================================
// §4 — an unlinked NAME field must never throw
// =============================================================================

describe('NAME decomposition — unlinked NAME field (§4)', () => {
  it('falls back to the raw store, warns, and does not throw', async () => {
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, ALL_FIELDS)

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: FIELD_NAME_UNLINKED.id,
      value: { firstName: 'Anita', lastName: 'Bicknell' },
    })

    // Pre-decomposition behavior: the composite lands on the NAME field's own
    // row as `valueJson`.
    expect(state.insertedRows).toHaveLength(1)
    expect(state.insertedRows[0]!.fieldId).toBe(FIELD_NAME_UNLINKED.id)
    expect(state.insertedRows[0]!.valueJson).toMatchObject({
      v: { firstName: 'Anita', lastName: 'Bicknell' },
    })
    expect(result.values).toHaveLength(1)
    expect(loggerWarn).toHaveBeenCalledWith(
      'NAME field has no linked part fields; storing the composite raw',
      expect.objectContaining({ fieldId: FIELD_NAME_UNLINKED.id })
    )
  })

  it('a half-linked NAME field (one part id only) also falls back', async () => {
    const half = fieldFixture('field-z-name-half', 'NAME', {
      name: { firstNameFieldId: FIELD_FIRST.id },
    })
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, [...ALL_FIELDS, half])

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: half.id,
      value: { firstName: 'Anita', lastName: 'Bicknell' },
    })

    expect(state.insertedRows).toHaveLength(1)
    expect(state.insertedRows[0]!.fieldId).toBe(half.id)
  })
})

// =============================================================================
// Door 2 — `setValuesForEntity` (record create/update via
// `resources/crud/unified-handler.ts`, the importer, multi-field saves)
// =============================================================================

describe('NAME decomposition — setValuesForEntity door', () => {
  it('decomposes and reports the result under the NAME fieldId with no values', async () => {
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, ALL_FIELDS)

    const results = await setValuesForEntity(ctx, {
      recordId,
      values: [{ fieldId: FIELD_NAME.id, value: { firstName: 'Anita', lastName: 'Bicknell' } }],
    })

    expect(writes(state)).toEqual([
      { fieldId: FIELD_FIRST.id, value: 'Anita' },
      { fieldId: FIELD_LAST.id, value: 'Bicknell' },
    ])
    expect(results).toHaveLength(1)
    expect(results[0]!.fieldId).toBe(FIELD_NAME.id)
    expect(results[0]!.values).toEqual([])
    expect(results[0]!.changed).toBe(true)
  })

  it('§4b: an explicit part write in the same op WINS over the composite', async () => {
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, ALL_FIELDS)

    // Input order deliberately puts the part FIRST; the two-level sort key
    // (`isNameField ? 0 : 1`, then fieldId) must still run the composite first
    // so the explicit part write lands last.
    await setValuesForEntity(ctx, {
      recordId,
      values: [
        { fieldId: FIELD_FIRST.id, value: 'Explicit' },
        { fieldId: FIELD_NAME.id, value: { firstName: 'Anita', lastName: 'Bicknell' } },
      ],
    })

    expect(writes(state)).toEqual([
      { fieldId: FIELD_FIRST.id, value: 'Anita' },
      { fieldId: FIELD_LAST.id, value: 'Bicknell' },
      { fieldId: FIELD_FIRST.id, value: 'Explicit' },
    ])
  })

  it('§4b: the part keys are invalidated in the batched pre-read, not the NAME key', async () => {
    const { db } = makeFakeDb()
    const ctx = makeCtx(db, ALL_FIELDS)

    const preloadedSetRows = new Map<string, any[]>([
      [`inst-1:${FIELD_NAME.id}`, []],
      [`inst-1:${FIELD_FIRST.id}`, []],
      [`inst-1:${FIELD_LAST.id}`, []],
    ])

    await setValuesForEntity(ctx, {
      recordId,
      values: [{ fieldId: FIELD_NAME.id, value: { firstName: 'Anita', lastName: 'Bicknell' } }],
      preloadedSetRows,
    })

    // Both part snapshots were written through, so both must be gone; the NAME
    // key is cleared too (harmless — nothing ever writes it).
    expect(preloadedSetRows.has(`inst-1:${FIELD_FIRST.id}`)).toBe(false)
    expect(preloadedSetRows.has(`inst-1:${FIELD_LAST.id}`)).toBe(false)
    expect(preloadedSetRows.has(`inst-1:${FIELD_NAME.id}`)).toBe(false)
  })
})

// =============================================================================
// Door 3 — `setBulkValues` / `applyBulk` (grid paste, bulk-update dialog)
// =============================================================================

describe('NAME decomposition — bulk door', () => {
  it('setBulkValues decomposes for every record', async () => {
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, ALL_FIELDS)

    await setBulkValues(ctx, {
      recordIds: [toRecordId('widget', 'inst-1'), toRecordId('widget', 'inst-2')],
      values: [{ fieldId: FIELD_NAME.id, value: 'Anita Bicknell' }],
    })

    expect(state.insertedRows.some((r) => r.fieldId === FIELD_NAME.id)).toBe(false)
    const byEntity = new Map<string, string[]>()
    for (const row of state.insertedRows) {
      byEntity.set(row.entityId, [...(byEntity.get(row.entityId) ?? []), row.fieldId])
    }
    expect(byEntity.get('inst-1')).toEqual([FIELD_FIRST.id, FIELD_LAST.id])
    expect(byEntity.get('inst-2')).toEqual([FIELD_FIRST.id, FIELD_LAST.id])
  })

  it('applyBulk with the default `set` mode decomposes', async () => {
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, ALL_FIELDS)

    await applyBulk(ctx, {
      recordIds: [recordId],
      values: [{ fieldId: FIELD_NAME.id, value: { firstName: 'Anita', lastName: 'Bicknell' } }],
    })

    expect(writes(state)).toEqual([
      { fieldId: FIELD_FIRST.id, value: 'Anita' },
      { fieldId: FIELD_LAST.id, value: 'Bicknell' },
    ])
  })

  it("applyBulk `mode: 'add'` on a NAME field still 400s, like every other single-valued type", async () => {
    // NAME is not in `MULTI_VALUE_FIELD_TYPES`, so `addValuesBulk`'s guard
    // rejects it — deliberately left alone. The "decompose silently, never
    // reject" decision is scoped to SET-shaped writes; `add` on a
    // single-valued field is a semantically wrong request and gets honest
    // feedback (plans/field-values/name-field-writes.md §3).
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, ALL_FIELDS)

    await expect(
      applyBulk(ctx, {
        recordIds: [recordId],
        values: [{ fieldId: FIELD_NAME.id, mode: 'add', value: 'Anita Bicknell' }],
      })
    ).rejects.toThrow(/not multi-value/)

    expect(state.insertedRows).toHaveLength(0)
  })
})

// =============================================================================
// Post-write ownership: ONE stamp + ONE searchText rebuild per composite write
// =============================================================================

/**
 * Part fields with a real `entityDefinition`, so `maybeUpdateDisplayValue`
 * runs past its `if (!entityDef) return` guard and reaches the searchText
 * refresh a TEXT (indexed-type) write would otherwise trigger per part. The
 * shared fixtures above carry `entityDefinition: null` and would make these
 * assertions pass vacuously.
 */
const ENTITY_DEF = {
  id: 'widget',
  primaryDisplayFieldId: null,
  secondaryDisplayFieldId: null,
  avatarFieldId: null,
}
const PART_FIRST = { ...fieldFixture('field-c-first', 'TEXT'), entityDefinition: ENTITY_DEF }
const PART_LAST = { ...fieldFixture('field-d-last', 'TEXT'), entityDefinition: ENTITY_DEF }
const NAME_OVER_PARTS = fieldFixture('field-z-name-owned', 'NAME', {
  name: { firstNameFieldId: PART_FIRST.id, lastNameFieldId: PART_LAST.id },
})
// Link reversed: `field-c-first` now holds the LAST name, so the part that
// sorts FIRST by fieldId is the one a single-word name leaves untouched.
const NAME_FLIPPED = fieldFixture('field-z-name-owned-flipped', 'NAME', {
  name: { firstNameFieldId: PART_LAST.id, lastNameFieldId: PART_FIRST.id },
})
const OWNED_FIELDS = [PART_FIRST, PART_LAST, NAME_OVER_PARTS, NAME_FLIPPED]

/**
 * The post-write work now rides ONE derived-column UPDATE per record
 * (`instance-derived.ts`): a bare D-7 stamp is a payload carrying `updatedAt`
 * without a display column, and a searchText rebuild is a payload carrying
 * `searchText`. The old `stampEntityInstanceUpdatedAt` / `updateSearchText`
 * helpers are no longer on this path, so the fake's captured payloads are the
 * evidence.
 */
function bareStamps(state: { updatedPayloads: any[] }): any[] {
  return state.updatedPayloads.filter((p) => 'updatedAt' in p && !('displayName' in p))
}
function searchTextFlushes(state: { updatedPayloads: any[] }): any[] {
  return state.updatedPayloads.filter((p) => 'searchText' in p)
}

describe('NAME decomposition — post-write ownership', () => {
  it('the single-set door stamps ONCE and rebuilds searchText ONCE, not twice', async () => {
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, OWNED_FIELDS)

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: NAME_OVER_PARTS.id,
      value: { firstName: 'Anita', lastName: 'Bicknell' },
    })

    // Two part writes landed, but the post-write work ran exactly once — the
    // parts were handed `skipInstanceStamp` / `skipSearchTextRefresh`.
    expect(bareStamps(state)).toHaveLength(1)
    expect(searchTextFlushes(state)).toHaveLength(1)
  })

  it('nested under a caller that owns both, the NAME frame stamps and flushes nothing', async () => {
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, OWNED_FIELDS)

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: NAME_OVER_PARTS.id,
      value: { firstName: 'Anita', lastName: 'Bicknell' },
      skipInstanceStamp: true,
      skipSearchTextRefresh: true,
    })

    // The write itself still happened; only the derived work is the caller's.
    expect(state.insertedRows).toHaveLength(2)
    expect(bareStamps(state)).toHaveLength(0)
    expect(searchTextFlushes(state)).toHaveLength(0)
  })

  it('EITHER part changing is enough — when only the FIRST-written part moves', async () => {
    // A single-word name coerces to `{firstName: 'Anita', lastName: ''}`; the
    // blank part is a B-14 clear-of-absent no-op against the empty store. By
    // fieldId order `field-c-first` (the first name here) is written FIRST, so
    // the LAST part write reports `changed: false`.
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, OWNED_FIELDS)

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: NAME_OVER_PARTS.id,
      value: 'Anita',
    })

    expect(writes(state)).toEqual([{ fieldId: PART_FIRST.id, value: 'Anita' }])
    expect(result.changed).toBe(true)
    expect(bareStamps(state)).toHaveLength(1)
    expect(searchTextFlushes(state)).toHaveLength(1)
  })

  it('EITHER part changing is enough — when only the LAST-written part moves', async () => {
    // Same input over the reversed link: `field-c-first` now receives the
    // blank last name and no-ops, and the change lands on the part written
    // second. `partChanged` must survive the earlier `false`.
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, OWNED_FIELDS)

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: NAME_FLIPPED.id,
      value: 'Anita',
    })

    expect(writes(state)).toEqual([{ fieldId: PART_LAST.id, value: 'Anita' }])
    expect(result.changed).toBe(true)
    expect(bareStamps(state)).toHaveLength(1)
    expect(searchTextFlushes(state)).toHaveLength(1)
  })

  it('a pure no-op composite write stamps nothing and rebuilds nothing', async () => {
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, OWNED_FIELDS)

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: NAME_OVER_PARTS.id,
      value: null,
    })

    expect(result.changed).toBe(false)
    expect(bareStamps(state)).toHaveLength(0)
    expect(searchTextFlushes(state)).toHaveLength(0)
  })
})

// =============================================================================
// The NAME-composed `displayName`: ONE recompute, ZERO sibling reads
// =============================================================================

/**
 * `displayName` writes the fake recorded, in order. The display UPDATE carries
 * `{ displayName, updatedAt }`; the bare D-7 stamp carries `{ updatedAt }`
 * alone, and a FieldValue reconcile carries value columns — so filtering on
 * the key counts display-column writes exactly.
 */
function displayWrites(state: { updatedPayloads: any[] }): Array<string | null> {
  return state.updatedPayloads.filter((p) => 'displayName' in p).map((p) => p.displayName)
}

const DISPLAY_NAME_ID = 'field-z-name-display'
const DISPLAY_DEF = {
  id: 'widget',
  primaryDisplayFieldId: DISPLAY_NAME_ID,
  secondaryDisplayFieldId: null,
  avatarFieldId: null,
}
const DISP_FIRST = { ...fieldFixture('field-e-first', 'TEXT'), entityDefinition: DISPLAY_DEF }
const DISP_LAST = { ...fieldFixture('field-f-last', 'TEXT'), entityDefinition: DISPLAY_DEF }
const DISPLAY_NAME_FIELD = {
  ...fieldFixture(DISPLAY_NAME_ID, 'NAME', {
    name: { firstNameFieldId: DISP_FIRST.id, lastNameFieldId: DISP_LAST.id },
  }),
  entityDefinition: DISPLAY_DEF,
}

// Reversed link, and the primary display field of its own definition — so the
// part that sorts FIRST by fieldId receives the LAST name.
const FLIPPED_DISPLAY_ID = 'field-z-name-display-flipped'
const FLIPPED_DEF = { ...DISPLAY_DEF, primaryDisplayFieldId: FLIPPED_DISPLAY_ID }
const FLIPPED_DISPLAY_FIELD = {
  ...fieldFixture(FLIPPED_DISPLAY_ID, 'NAME', {
    name: { firstNameFieldId: DISP_LAST.id, lastNameFieldId: DISP_FIRST.id },
  }),
  entityDefinition: FLIPPED_DEF,
}

// A linked NAME field that is NOT its definition's primary display field —
// the record is titled by a plain TEXT field instead.
const TITLE_FIELD = fieldFixture('field-g-title', 'TEXT')
const NON_PRIMARY_DEF = { ...DISPLAY_DEF, primaryDisplayFieldId: TITLE_FIELD.id }
const NON_PRIMARY_NAME_FIELD = {
  ...fieldFixture('field-z-name-non-primary', 'NAME', {
    name: { firstNameFieldId: DISP_FIRST.id, lastNameFieldId: DISP_LAST.id },
  }),
  entityDefinition: NON_PRIMARY_DEF,
}

const DISPLAY_FIELDS = [
  DISP_FIRST,
  DISP_LAST,
  TITLE_FIELD,
  DISPLAY_NAME_FIELD,
  FLIPPED_DISPLAY_FIELD,
  NON_PRIMARY_NAME_FIELD,
]

describe('NAME decomposition — composed displayName', () => {
  it('both parts change: ONE displayName write, ZERO sibling SELECTs', async () => {
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, DISPLAY_FIELDS)

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: DISPLAY_NAME_ID,
      value: { firstName: 'Anita', lastName: 'Bicknell' },
    })

    // Before this change each part write recomposed for itself: two sibling
    // reads and two display UPDATEs, the second read re-reading the row the
    // first write had just committed.
    expect(state.siblingSelects).toBe(0)
    expect(displayWrites(state)).toEqual(['Anita Bicknell'])
  })

  it('the display write carries the stamp, so no second bare UPDATE is issued', async () => {
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, DISPLAY_FIELDS)

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: DISPLAY_NAME_ID,
      value: { firstName: 'Anita', lastName: 'Bicknell' },
    })

    // `displayName` and `updatedAt` go in one statement; a separate D-7 stamp
    // would be a second UPDATE on the same row for the same reason.
    expect(bareStamps(state)).toHaveLength(0)
    // The searchText flush is still this frame's, and still fires once.
    expect(searchTextFlushes(state)).toHaveLength(1)
  })

  it('only the FIRST-written part changes: displayName still recomputes', async () => {
    // The reported shape: `Anita Smith` → `Bob Smith` leaves `last_name`
    // byte-identical, so the second part write is a D-6 no-op. A single-word
    // name reproduces it against an empty store — `lastName` coerces to `''`
    // and B-14 no-ops. Hanging the recompute off the last write would strand
    // `displayName` here.
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, DISPLAY_FIELDS)

    await setValueWithBuiltIn(ctx, { recordId, fieldId: DISPLAY_NAME_ID, value: 'Anita' })

    expect(writes(state)).toEqual([{ fieldId: DISP_FIRST.id, value: 'Anita' }])
    expect(displayWrites(state)).toEqual(['Anita'])
    expect(state.siblingSelects).toBe(0)
  })

  it('only the LAST-written part changes: displayName still recomputes', async () => {
    // Same input over the reversed link — the change now lands on the part
    // written second, so `partChanged` has to survive the earlier `false`.
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, DISPLAY_FIELDS)

    await setValueWithBuiltIn(ctx, { recordId, fieldId: FLIPPED_DISPLAY_ID, value: 'Anita' })

    expect(writes(state)).toEqual([{ fieldId: DISP_LAST.id, value: 'Anita' }])
    expect(displayWrites(state)).toEqual(['Anita'])
    expect(state.siblingSelects).toBe(0)
  })

  it('both parts no-op: no recompute, no display write, no stamp', async () => {
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, DISPLAY_FIELDS)

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: DISPLAY_NAME_ID,
      value: null,
    })

    expect(result.changed).toBe(false)
    expect(displayWrites(state)).toEqual([])
    expect(state.siblingSelects).toBe(0)
    expect(bareStamps(state)).toHaveLength(0)
    expect(searchTextFlushes(state)).toHaveLength(0)
  })

  it('clearing a composed name writes displayName = null exactly once', async () => {
    const rows = [
      {
        id: 'fv-first',
        entityId: 'inst-1',
        entityDefinitionId: 'widget',
        fieldId: DISP_FIRST.id,
        organizationId: 'org-1',
        valueText: 'Anita',
        valueNumber: null,
        valueBoolean: null,
        valueDate: null,
        valueJson: null,
        optionId: null,
        relatedEntityId: null,
        relatedEntityDefinitionId: null,
        actorId: null,
        aiStatus: null,
        sortKey: 'a0',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]
    const { db, state } = makeFakeDb(rows)
    const ctx = makeCtx(db, DISPLAY_FIELDS)

    await setValueWithBuiltIn(ctx, { recordId, fieldId: DISPLAY_NAME_ID, value: null })

    expect(displayWrites(state)).toEqual([null])
    expect(state.siblingSelects).toBe(0)
  })

  it('a NAME field that is NOT the primary display field recomputes nothing', async () => {
    const { db, state } = makeFakeDb()
    const ctx = makeCtx(db, DISPLAY_FIELDS)

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: NON_PRIMARY_NAME_FIELD.id,
      value: { firstName: 'Anita', lastName: 'Bicknell' },
    })

    // The parts still land; only the display column stays untouched — the same
    // answer a direct part write gives today.
    expect(writes(state)).toEqual([
      { fieldId: DISP_FIRST.id, value: 'Anita' },
      { fieldId: DISP_LAST.id, value: 'Bicknell' },
    ])
    expect(displayWrites(state)).toEqual([])
    expect(state.siblingSelects).toBe(0)
    // Nothing wrote `updatedAt` for us, so the D-7 stamp is this frame's again.
    expect(bareStamps(state)).toHaveLength(1)
  })
})
