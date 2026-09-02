// packages/lib/src/field-values/__tests__/set-idempotency.test.ts
//
// D-6 idempotency guard on the forward `set` path + B-14 delete-of-absent
// (plans/events/03-write-context-and-batch-lane-plan.md Phase 2;
// docs/skip-events-history.md §8 D3): an identical `set` must not write at
// all, must not fire the post-hook chain, must not publish realtime, and
// must not collect native field triggers — while any real change (including
// an AI stage-2 commit re-asserting the same value) writes. Since
// plans/field-values/delete-insert-replace.md Phase 1 the changed path is a
// positional reconcile — in-place UPDATEs on surviving rows, tail
// INSERT/DELETE only on count changes — so the shape pins here assert
// updates, not DELETE+INSERT.

import type { FieldId } from '@auxx/types/field'
import { toRecordId } from '@auxx/types/resource'

// ⚠️ Mock '../../realtime/publish-helpers' directly — NOT the '../../realtime'
// barrel (see batched-realtime-publish.test.ts for the import-cycle rationale).
vi.mock('../../realtime/publish-helpers', () => ({
  publishFieldValueUpdates: vi.fn(),
}))

// '../../cache' is a large barrel with real DB/Redis-backed providers. Mock it
// wholesale; the entry points this suite's code path touches are
// `getCachedFieldMap`/`getCachedResource` (field-value-mutations),
// `getOrgCache` (resolveFieldIds), and `getAllCachedCustomFields`/
// `getCachedRecordRules` (collectTriggeredFields — reached on the changed path
// because `ctx.userId` is set so the post-hook/trigger branches run).
vi.mock('../../cache', () => ({
  getCachedFieldMap: vi.fn(),
  getCachedResource: vi.fn(),
  getOrgCache: vi.fn(),
  getAllCachedCustomFields: vi.fn(async () => []),
  getCachedRecordRules: vi.fn(async () => []),
}))

// The field-hooks registry is imported (in the loaded graph) only by
// field-value-mutations.ts, so a full-replacement mock is safe here. Entity
// hooks are "registered" so `willFirePostHook` is true and the guard's
// hook-suppression is actually observable; pre-hooks stay empty so the write
// value passes through untransformed.
vi.mock('../../field-hooks/registry', () => ({
  hasEntityFieldChangeHooks: vi.fn(() => true),
  hasFieldTypeChangeHooks: vi.fn(() => false),
  hasFieldPreHooks: vi.fn(() => false),
  getEntityFieldChangeHooks: vi.fn(() => []),
  getFieldTypeChangeHooks: vi.fn(() => []),
  getFieldPreHooks: vi.fn(() => []),
}))

// Native field-trigger collection (step 8 of setValueWithBuiltIn). Mocked so
// the no-op assertions can distinguish "collected but empty" from "never
// collected at all".
vi.mock('../../field-hooks/collect-triggers', () => ({
  collectTriggeredFields: vi.fn(async () => []),
  deduplicateBySystemAttribute: vi.fn((fields: unknown[]) => fields),
}))
vi.mock('../../field-hooks/publish', () => ({
  publishFieldTriggerEvents: vi.fn(async () => {}),
  publishBatchFieldTriggerEvents: vi.fn(async () => {}),
}))

// Snapshot resolution runs inside `firePostHook`; its ref-lookups are
// irrelevant here, so stub it to fixed displays.
vi.mock('../timeline-snapshot', () => ({
  preloadSnapshotCache: vi.fn(),
  resolveFieldChangeSnapshotPair: vi.fn(async () => ({ oldDisplay: null, newDisplay: null })),
  resolveFieldChangeSnapshotsBulk: vi.fn(async () => new Map()),
}))

import { getCachedResource, getOrgCache } from '../../cache'
import { collectTriggeredFields } from '../../field-hooks/collect-triggers'
import { getEntityFieldChangeHooks } from '../../field-hooks/registry'
import { publishFieldValueUpdates } from '../../realtime/publish-helpers'
import { createFieldValueContext, type FieldValueContext } from '../field-value-helpers'
import { setValueWithBuiltIn } from '../field-value-mutations'

const mockedGetCachedResource = getCachedResource as unknown as ReturnType<typeof vi.fn>
const mockedGetOrgCache = getOrgCache as unknown as ReturnType<typeof vi.fn>
const mockedGetEntityHooks = getEntityFieldChangeHooks as unknown as ReturnType<typeof vi.fn>
const mockedCollectTriggers = vi.mocked(collectTriggeredFields)
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

const FIELD_TEXT = fieldFixture('field-text', 'TEXT')
const FIELD_TAGS = fieldFixture('field-tags', 'TAGS')
const FIELD_JSON = fieldFixture('field-json', 'JSON')

/** A stored FieldValue row for (inst-1, fieldId) with payload overrides. */
function existingRow(
  id: string,
  fieldId: string,
  sortKey: string,
  payload: Record<string, unknown>
) {
  return {
    id,
    entityId: 'inst-1',
    entityDefinitionId: 'widget',
    fieldId,
    organizationId: 'org-1',
    valueText: null,
    valueNumber: null,
    valueBoolean: null,
    valueDate: null,
    valueJson: null,
    optionId: null,
    relatedEntityId: null,
    relatedEntityDefinitionId: null,
    actorId: null,
    aiStatus: null,
    sortKey,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...payload,
  }
}

/**
 * Hand-rolled chainable `ctx.db` fake (Drizzle's `schema.*` column refs are
 * `{}` under this repo's vitest setup — see project memory — so the fake
 * ignores every `where()` argument). All `select(...).from(...).where(...)
 * .orderBy(...)` reads resolve to `existingRows` (given already in sortKey
 * order); `delete`/`insert` calls are counted so tests can assert the
 * DELETE+INSERT did or did not run.
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
    select: () => chain,
    from: () => chain,
    orderBy: () => Promise.resolve(existingRows),
    update: () => {
      state.updateCalls++
      return chain
    },
    set: (payload: any) => {
      state.updatedPayloads.push(payload)
      return chain
    },
    // The set path wraps its replace in a transaction + advisory lock; run
    // both on the same fake so delete/insert counting still works.
    transaction: async (fn: (tx: any) => Promise<any>) => fn(chain),
    execute: () => Promise.resolve([]),
  })
  return { db: chain, state }
}

/** Context with a REAL userId so the post-hook / field-trigger gates are open. */
function makeCtx(db: any, fields: ReturnType<typeof fieldFixture>[]): FieldValueContext {
  const ctx = createFieldValueContext('org-1', 'user-1', db, 'socket-abc')
  for (const f of fields) ctx.fieldCache.set(f.id, f as any)
  return ctx
}

const hookSpy = vi.fn(async (_event: unknown) => {})

beforeEach(() => {
  vi.clearAllMocks()
  mockedGetCachedResource.mockResolvedValue(undefined)
  mockedPublish.mockResolvedValue(undefined)
  mockedCollectTriggers.mockResolvedValue([])
  mockedGetEntityHooks.mockReturnValue([hookSpy])
  // resolveFieldIds needs `.from(orgId, 'customFields').all()`; getField's
  // cache-miss fallback needs `.byId()` (never hit — fieldCache is pre-warmed).
  mockedGetOrgCache.mockReturnValue({
    from: () => ({ all: async () => ({}), byId: async () => undefined }),
  })
})

// =============================================================================
// D-6 — forward set
// =============================================================================

describe('set idempotency guard (D-6)', () => {
  it('identical scalar set: no DELETE+INSERT, no post-hook, no realtime, existing row ids preserved', async () => {
    const rows = [existingRow('fv-existing-1', 'field-text', 'a0', { valueText: 'hello' })]
    const { db, state } = makeFakeDb(rows)
    const ctx = makeCtx(db, [FIELD_TEXT])

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: 'hello',
    })

    expect(result.state).toBe('complete')
    expect(result.values).toHaveLength(1)
    expect(result.values[0]!.id).toBe('fv-existing-1')
    expect((result.values[0] as any).value).toBe('hello')

    expect(state.deleteCalls).toBe(0)
    expect(state.insertCalls).toBe(0)
    expect(hookSpy).not.toHaveBeenCalled()
    expect(mockedPublish).not.toHaveBeenCalled()
    expect(mockedCollectTriggers).not.toHaveBeenCalled()
  })

  it('changed scalar set: one in-place UPDATE runs and the post-hook fires', async () => {
    const rows = [existingRow('fv-existing-1', 'field-text', 'a0', { valueText: 'hello' })]
    const { db, state } = makeFakeDb(rows)
    const ctx = makeCtx(db, [FIELD_TEXT])

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: 'world',
    })

    expect(result.state).toBe('complete')
    expect((result.values[0] as any).value).toBe('world')
    // The reconcile updates the surviving row in place — same row id, no
    // DELETE+INSERT (delete-insert-replace.md §5B).
    expect(result.values[0]!.id).toBe('fv-existing-1')
    expect(state.deleteCalls).toBe(0)
    expect(state.insertCalls).toBe(0)
    // The in-place FieldValue UPDATE plus the record's derived-column flush
    // (`instance-derived.ts`): stamp, activity and searchText in ONE statement.
    expect(state.updateCalls).toBe(2)
    expect(state.updatedPayloads[0]).toMatchObject({ valueText: 'world', aiStatus: null })
    expect(hookSpy).toHaveBeenCalledTimes(1)
    const event = hookSpy.mock.calls[0]![0] as any
    expect(event.newValue).toMatchObject({ type: 'text', value: 'world' })
    expect(mockedPublish).toHaveBeenCalledTimes(1)
  })

  it('multi-value set, same values in the same sortKey order: no-op', async () => {
    const rows = [
      existingRow('fv-a', 'field-tags', 'a0', { optionId: 'opt-a' }),
      existingRow('fv-b', 'field-tags', 'a1', { optionId: 'opt-b' }),
    ]
    const { db, state } = makeFakeDb(rows)
    const ctx = makeCtx(db, [FIELD_TAGS])

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-tags',
      value: ['opt-a', 'opt-b'],
    })

    expect(result.state).toBe('complete')
    expect(result.values.map((v) => v.id)).toEqual(['fv-a', 'fv-b'])
    expect(state.deleteCalls).toBe(0)
    expect(state.insertCalls).toBe(0)
    expect(hookSpy).not.toHaveBeenCalled()
    expect(mockedPublish).not.toHaveBeenCalled()
  })

  it('multi-value set, same values in a DIFFERENT order: writes', async () => {
    const rows = [
      existingRow('fv-a', 'field-tags', 'a0', { optionId: 'opt-a' }),
      existingRow('fv-b', 'field-tags', 'a1', { optionId: 'opt-b' }),
    ]
    const { db, state } = makeFakeDb(rows)
    const ctx = makeCtx(db, [FIELD_TAGS])

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-tags',
      value: ['opt-b', 'opt-a'],
    })

    // Positional matching: both rows survive with payloads swapped in place.
    expect(state.deleteCalls).toBe(0)
    expect(state.insertCalls).toBe(0)
    // Two in-place FieldValue UPDATEs plus the derived-column flush.
    expect(state.updateCalls).toBe(3)
    expect(state.updatedPayloads.slice(0, 2).map((r) => r.optionId)).toEqual(['opt-b', 'opt-a'])
    expect(hookSpy).toHaveBeenCalledTimes(1)
  })

  it('multi-value set with a different row COUNT: writes', async () => {
    const rows = [existingRow('fv-a', 'field-tags', 'a0', { optionId: 'opt-a' })]
    const { db, state } = makeFakeDb(rows)
    const ctx = makeCtx(db, [FIELD_TAGS])

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-tags',
      value: ['opt-a', 'opt-b'],
    })

    // The identical first position is kept untouched; only the tail inserts.
    expect(state.deleteCalls).toBe(0)
    // No FieldValue UPDATE; the one UPDATE is the record's derived-column flush.
    expect(state.updateCalls).toBe(1)
    expect(state.insertCalls).toBe(1)
    expect(state.insertedRows.map((r) => r.optionId)).toEqual(['opt-b'])
  })

  it('JSON value identical modulo object key order: no-op', async () => {
    const rows = [
      existingRow('fv-json-1', 'field-json', 'a0', {
        // Stored envelope form, keys in one order…
        valueJson: { v: { b: { d: 2, c: [1, 2] }, a: 1 } },
      }),
    ]
    const { db, state } = makeFakeDb(rows)
    const ctx = makeCtx(db, [FIELD_JSON])

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-json',
      // …incoming value structurally equal with keys in another order.
      value: { a: 1, b: { c: [1, 2], d: 2 } },
    })

    expect(result.values[0]!.id).toBe('fv-json-1')
    expect(state.deleteCalls).toBe(0)
    expect(state.insertCalls).toBe(0)
    expect(hookSpy).not.toHaveBeenCalled()
    expect(mockedPublish).not.toHaveBeenCalled()
  })

  it('JSON value with a real difference: writes', async () => {
    const rows = [
      existingRow('fv-json-1', 'field-json', 'a0', {
        valueJson: { v: { a: 1, b: 2 } },
      }),
    ]
    const { db, state } = makeFakeDb(rows)
    const ctx = makeCtx(db, [FIELD_JSON])

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-json',
      value: { a: 1, b: 3 },
    })

    expect(state.deleteCalls).toBe(0)
    expect(state.insertCalls).toBe(0)
    // The in-place FieldValue UPDATE plus the record's derived-column flush
    // (`instance-derived.ts`): stamp, activity and searchText in ONE statement.
    expect(state.updateCalls).toBe(2)
  })

  it('identical set WITH aiGeneration metadata: guard bypassed, write proceeds', async () => {
    const rows = [existingRow('fv-existing-1', 'field-text', 'a0', { valueText: 'hello' })]
    const { db, state } = makeFakeDb(rows)
    const ctx = makeCtx(db, [FIELD_TEXT])

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: 'hello',
      aiGeneration: { model: 'test-model' } as any,
    })

    expect(result.state).toBe('complete')
    // Identical payload, marker differs — the reconcile applies the marker to
    // the SURVIVING row in place instead of re-minting it.
    expect(state.deleteCalls).toBe(0)
    expect(state.insertCalls).toBe(0)
    // The in-place FieldValue UPDATE plus the record's derived-column flush
    // (`instance-derived.ts`): stamp, activity and searchText in ONE statement.
    expect(state.updateCalls).toBe(2)
    expect(state.updatedPayloads[0]).toMatchObject({ aiStatus: 'result' })
    expect(result.values[0]!.id).toBe('fv-existing-1')
  })

  it('identical value but the stored row carries an AI marker: writes (manual set must clear it)', async () => {
    const rows = [
      existingRow('fv-existing-1', 'field-text', 'a0', {
        valueText: 'hello',
        aiStatus: 'result',
        valueJson: { meta: { ai: { model: 'test-model' } } },
      }),
    ]
    const { db, state } = makeFakeDb(rows)
    const ctx = makeCtx(db, [FIELD_TEXT])

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: 'hello',
    })

    // The marker clears IN PLACE: explicit aiStatus null on the update.
    expect(state.deleteCalls).toBe(0)
    expect(state.insertCalls).toBe(0)
    // The in-place FieldValue UPDATE plus the record's derived-column flush
    // (`instance-derived.ts`): stamp, activity and searchText in ONE statement.
    expect(state.updateCalls).toBe(2)
    expect(state.updatedPayloads[0]).toMatchObject({ aiStatus: null })
  })
})

// =============================================================================
// B-14 — delete-of-absent
// =============================================================================

describe('null/clear set (B-14)', () => {
  it('clear with NO existing rows: complete no-op — no delete, no hook, no realtime', async () => {
    const { db, state } = makeFakeDb([])
    const ctx = makeCtx(db, [FIELD_TEXT])

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: null,
    })

    expect(result).toMatchObject({ state: 'complete', values: [] })
    expect(state.deleteCalls).toBe(0)
    expect(state.insertCalls).toBe(0)
    expect(hookSpy).not.toHaveBeenCalled()
    expect(mockedPublish).not.toHaveBeenCalled()
  })

  it('clear with existing rows: deletes, fires the post-hook, publishes the clear', async () => {
    const rows = [existingRow('fv-existing-1', 'field-text', 'a0', { valueText: 'hello' })]
    const { db, state } = makeFakeDb(rows)
    const ctx = makeCtx(db, [FIELD_TEXT])

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: null,
    })

    expect(result).toMatchObject({ state: 'complete', values: [] })
    expect(state.deleteCalls).toBe(1)
    expect(hookSpy).toHaveBeenCalledTimes(1)
    const event = hookSpy.mock.calls[0]![0] as any
    expect(event.newValue).toBeNull()
    expect(mockedPublish).toHaveBeenCalledTimes(1)
    const [, , entries] = mockedPublish.mock.calls[0]! as any[]
    expect(entries[0]).toMatchObject({ value: null, aiStatus: null })
  })
})
