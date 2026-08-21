// packages/lib/src/field-values/__tests__/instance-updated-at-stamp.test.ts
//
// D-7 (plans/events/03-write-context-and-batch-lane-plan.md §1):
// `EntityInstance.updatedAt` lost its `$onUpdate` and is stamped EXPLICITLY.
// `setValuesForEntity` is the chokepoint for handler-mediated field writes:
// a record write that performs at least one REAL change stamps `updatedAt`
// exactly once; an idempotent no-op (D-6 guard) or delete-of-absent (B-14)
// stamps nothing — that is the whole point, a bookkeeping-shaped write must
// not re-dirty the dedup watermark.

import { toRecordId } from '@auxx/types/resource'

// ⚠️ Mock '../../realtime/publish-helpers' directly — NOT the '../../realtime'
// barrel (see batched-realtime-publish.test.ts for the import-cycle rationale).
vi.mock('../../realtime/publish-helpers', () => ({
  publishFieldValueUpdates: vi.fn(),
}))

// '../../cache' is a large barrel with real DB/Redis-backed providers. Mock it
// wholesale (same set as set-idempotency.test.ts).
vi.mock('../../cache', () => ({
  getCachedFieldMap: vi.fn(),
  getCachedResource: vi.fn(),
  getOrgCache: vi.fn(),
  getAllCachedCustomFields: vi.fn(async () => []),
  getCachedRecordRules: vi.fn(async () => []),
}))

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

vi.mock('../timeline-snapshot', () => ({
  preloadSnapshotCache: vi.fn(),
  resolveFieldChangeSnapshotPair: vi.fn(async () => ({ oldDisplay: null, newDisplay: null })),
  resolveFieldChangeSnapshotsBulk: vi.fn(async () => new Map()),
}))

import { schema } from '@auxx/database'
import { getCachedFieldMap, getCachedResource, getOrgCache } from '../../cache'
import { publishFieldValueUpdates } from '../../realtime/publish-helpers'
import { createFieldValueContext, type FieldValueContext } from '../field-value-helpers'
import { setValuesForEntity } from '../field-value-mutations'

const mockedGetCachedFieldMap = getCachedFieldMap as unknown as ReturnType<typeof vi.fn>
const mockedGetCachedResource = getCachedResource as unknown as ReturnType<typeof vi.fn>
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

const FIELD_A = fieldFixture('field-a', 'TEXT')
const FIELD_B = fieldFixture('field-b', 'TEXT')

/** A stored FieldValue row for (inst-1, fieldId) with payload overrides. */
function existingRow(id: string, fieldId: string, payload: Record<string, unknown>) {
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
    sortKey: 'a0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...payload,
  }
}

/**
 * Chainable `ctx.db` fake in the style of set-idempotency.test.ts, extended to
 * CAPTURE `update(table).set(payload)` pairs — the D-7 stamp is an
 * `update(schema.EntityInstance).set({ updatedAt })`, and the global setup
 * proxy memoizes `schema.*` so the table is comparable by reference.
 * FieldValue reads resolve per-field from `rowsByField`.
 */
function makeFakeDb(rowsByField: Record<string, any[]> = {}) {
  let idSeq = 0
  let pendingValues: any[] = []
  const state = {
    deleteCalls: 0,
    insertCalls: 0,
    updates: [] as Array<{ table: unknown; set: Record<string, unknown> }>,
  }
  let currentUpdateTable: unknown = null
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
    // The reads this path performs (loadExistingRowsForSet, oldValue fetch)
    // are always scoped to one fieldId, but the fake ignores conditions —
    // flatten every field's rows; the guard comparison keys on fieldId anyway.
    orderBy: () => Promise.resolve(Object.values(rowsByField).flat()),
    update: (table: unknown) => {
      currentUpdateTable = table
      return chain
    },
    set: (payload: Record<string, unknown>) => {
      state.updates.push({ table: currentUpdateTable, set: payload })
      return chain
    },
  })
  return { db: chain, state }
}

function makeCtx(db: any, fields: ReturnType<typeof fieldFixture>[]): FieldValueContext {
  const ctx = createFieldValueContext('org-1', 'user-1', db, 'socket-abc')
  for (const f of fields) ctx.fieldCache.set(f.id, f as any)
  return ctx
}

/** The D-7 chokepoint stamps: EntityInstance updates carrying `updatedAt`. */
function stampWrites(state: ReturnType<typeof makeFakeDb>['state']) {
  return state.updates.filter((u) => u.table === schema.EntityInstance && 'updatedAt' in u.set)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedPublish.mockResolvedValue(undefined)
  mockedGetCachedResource.mockResolvedValue(undefined)
  mockedGetCachedFieldMap.mockResolvedValue(
    new Map([
      [FIELD_A.id, FIELD_A],
      [FIELD_B.id, FIELD_B],
    ])
  )
  mockedGetOrgCache.mockReturnValue({
    from: () => ({ all: async () => ({}), byId: async () => undefined }),
  })
})

// =============================================================================
// D-7 — explicit `EntityInstance.updatedAt` stamp
// =============================================================================

describe('setValuesForEntity D-7 updatedAt stamp', () => {
  it('a real field change stamps EntityInstance.updatedAt exactly once', async () => {
    const { db, state } = makeFakeDb({
      'field-a': [existingRow('fv-a', 'field-a', { valueText: 'old' })],
    })
    const ctx = makeCtx(db, [FIELD_A])

    const results = await setValuesForEntity(ctx, {
      recordId,
      values: [{ fieldId: 'field-a', value: 'new' }],
    })

    expect(results).toHaveLength(1)
    expect(results[0]!.changed).toBe(true)
    expect(state.deleteCalls).toBe(1)
    expect(state.insertCalls).toBe(1)

    const stamps = stampWrites(state)
    expect(stamps).toHaveLength(1)
    expect(stamps[0]!.set.updatedAt).toBeInstanceOf(Date)
    // The stamp is a pure freshness write — it must not smuggle other columns.
    expect(Object.keys(stamps[0]!.set)).toEqual(['updatedAt'])
  })

  it('an idempotent no-op set (D-6 guard hit) does NOT stamp', async () => {
    const { db, state } = makeFakeDb({
      'field-a': [existingRow('fv-a', 'field-a', { valueText: 'same' })],
    })
    const ctx = makeCtx(db, [FIELD_A])

    const results = await setValuesForEntity(ctx, {
      recordId,
      values: [{ fieldId: 'field-a', value: 'same' }],
    })

    expect(results[0]!.changed).toBe(false)
    expect(state.deleteCalls).toBe(0)
    expect(state.insertCalls).toBe(0)
    expect(stampWrites(state)).toHaveLength(0)
  })

  it('delete-of-absent (B-14) does NOT stamp', async () => {
    const { db, state } = makeFakeDb({})
    const ctx = makeCtx(db, [FIELD_A])

    const results = await setValuesForEntity(ctx, {
      recordId,
      values: [{ fieldId: 'field-a', value: null }],
    })

    expect(results[0]!.changed).toBe(false)
    expect(state.deleteCalls).toBe(0)
    expect(stampWrites(state)).toHaveLength(0)
  })

  it('mixed write (one changed, one unchanged) stamps exactly once', async () => {
    const { db, state } = makeFakeDb({
      'field-a': [existingRow('fv-a', 'field-a', { valueText: 'same' })],
    })
    const ctx = makeCtx(db, [FIELD_A, FIELD_B])

    const results = await setValuesForEntity(ctx, {
      recordId,
      values: [
        // field-a re-asserts the stored value (no-op)…
        { fieldId: 'field-a', value: 'same' },
        // …field-b is a real change. NOTE: the fake serves field-a's stored
        // row for BOTH guard reads (it ignores where-conditions), but the
        // guard compares by fieldId+value, so field-b still registers as
        // changed against a row belonging to a different field.
        { fieldId: 'field-b', value: 'brand-new' },
      ],
    })

    const byField = new Map(results.map((r) => [r.fieldId, r]))
    expect(byField.get('field-a')!.changed).toBe(false)
    expect(byField.get('field-b')!.changed).toBe(true)
    expect(stampWrites(state)).toHaveLength(1)
  })
})
