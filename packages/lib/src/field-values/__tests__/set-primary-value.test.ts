// packages/lib/src/field-values/__tests__/set-primary-value.test.ts
//
// C6 (multi-email plan): `setPrimaryValue` promotes one row of a multi-value
// field to primary via a single-row sortKey UPDATE — no delete/insert — then
// recomputes display columns (the subtitle must follow the new primary even
// though no VALUE was written) and publishes the FULL array (a publish entry
// without a `value` is silently dropped by the realtime layer).

import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import { toRecordId } from '@auxx/types/resource'

// ⚠️ Mock the publish-helpers LEAF, not the '../../realtime' barrel — same
// import-cycle gotcha as batched-realtime-publish.test.ts.
vi.mock('../../realtime/publish-helpers', () => ({
  publishFieldValueUpdates: vi.fn(),
}))

// Mock the cache barrel WHOLESALE (never partial-mock via importOriginal —
// loading the real barrel inside the factory walks its import graph before the
// mock exists and modules capture the real fns). The entries cover everything
// this path can touch: getField's fallback, maybeUpdateDisplayValue's cascade
// (getCachedResource / getCachedResources via display-field-deps), and the
// mail gate in getValue (findCachedResource / getCachedUserInstanceGrants).
vi.mock('../../cache', () => ({
  getCachedFieldMap: vi.fn(),
  getCachedResource: vi.fn(),
  getCachedResources: vi.fn(),
  getOrgCache: vi.fn(),
  findCachedResource: vi.fn(),
  getCachedUserInstanceGrants: vi.fn(),
}))

import { getCachedResource, getCachedResources, getOrgCache } from '../../cache'
import { NotFoundError } from '../../errors'
import { publishFieldValueUpdates } from '../../realtime/publish-helpers'
import { createFieldValueContext } from '../field-value-helpers'
import { addValues, setPrimaryValue } from '../field-value-mutations'

const mockedGetCachedResource = getCachedResource as unknown as ReturnType<typeof vi.fn>
const mockedGetCachedResources = getCachedResources as unknown as ReturnType<typeof vi.fn>
const mockedGetOrgCache = getOrgCache as unknown as ReturnType<typeof vi.fn>
const mockedPublish = vi.mocked(publishFieldValueUpdates)

const ORG = 'org-1'
const FIELD_ID = 'field-email'
const recordId = toRecordId('widget', 'inst-1')

/**
 * Chainable fake db. `select()` chains resolve to the next queued result (or
 * `[]`); `update().set()` chains record their payload into `updates` and
 * resolve to `[]`; `execute` (raw searchText UPDATE) resolves to `[]`.
 * No assertion depends on Drizzle column refs (undefined under the vitest
 * schema mock) — where() args are ignored entirely.
 */
function makeFakeDb(
  selectQueue: unknown[][],
  updates: Array<Record<string, unknown>>,
  inserts: Array<Record<string, unknown>[]> = []
) {
  function selectChain() {
    const c: any = {
      from: () => c,
      where: () => c,
      leftJoin: () => c,
      innerJoin: () => c,
      limit: () => c,
      orderBy: () => c,
      // biome-ignore lint/suspicious/noThenProperty: deliberate thenable — awaited like a Drizzle builder
      then: (resolve: any, reject: any) =>
        Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject),
    }
    return c
  }
  function updateChain() {
    const c: any = {
      set: (vals: Record<string, unknown>) => {
        updates.push(vals)
        return c
      },
      where: () => c,
      // biome-ignore lint/suspicious/noThenProperty: deliberate thenable — awaited like a Drizzle builder
      then: (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject),
    }
    return c
  }
  function insertChain() {
    let pending: Record<string, unknown>[] = []
    let idSeq = 0
    const c: any = {
      values: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        pending = Array.isArray(rows) ? rows : [rows]
        inserts.push(pending)
        return c
      },
      onConflictDoUpdate: () => c,
      returning: () =>
        Promise.resolve(
          pending.map((r) => ({
            id: `fv-new-${idSeq++}`,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            ...r,
          }))
        ),
    }
    return c
  }
  const db: any = {
    select: () => selectChain(),
    update: () => updateChain(),
    insert: () => insertChain(),
    execute: async () => [],
  }
  // addValues wraps its critical section in a transaction; run it on the
  // same fake so all captures land in the shared arrays.
  db.transaction = async (fn: (tx: any) => Promise<unknown>) => fn(db)
  return db
}

/** Multi-EMAIL field wired as the entity's secondary display field. */
const FIELD = {
  id: FIELD_ID,
  type: 'EMAIL',
  options: { multi: true },
  entityDefinitionId: 'widget',
  entityType: null,
  isUnique: false,
  systemAttribute: null,
  entityDefinition: {
    id: 'widget',
    primaryDisplayFieldId: null,
    secondaryDisplayFieldId: FIELD_ID,
    avatarFieldId: null,
  },
} as any

/** FieldValue row fixture in DB shape (valueText column for EMAIL). */
function row(id: string, email: string, sortKey: string) {
  return {
    id,
    entityId: 'inst-1',
    fieldId: FIELD_ID,
    organizationId: ORG,
    sortKey,
    valueText: email,
    valueNumber: null,
    valueBoolean: null,
    valueDate: null,
    valueJson: null,
    optionId: null,
    relatedEntityId: null,
    relatedEntityDefinitionId: null,
    actorId: null,
    aiStatus: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeCtx(db: any) {
  const ctx = createFieldValueContext(ORG, undefined, db, 'socket-abc')
  // Pre-seed the per-context field cache so getField never hits the org cache.
  ctx.fieldCache.set(FIELD_ID, FIELD)
  return ctx
}

describe('setPrimaryValue', () => {
  beforeEach(() => {
    mockedPublish.mockReset()
    mockedPublish.mockResolvedValue(undefined)
    mockedGetCachedResource.mockReset()
    mockedGetCachedResource.mockResolvedValue(undefined)
    mockedGetCachedResources.mockReset()
    mockedGetCachedResources.mockResolvedValue([])
    mockedGetOrgCache.mockReset()
    mockedGetOrgCache.mockReturnValue({
      from: () => ({ all: async () => ({}), byId: async () => undefined }),
    })
  })

  it('moves the target row to the front with a single sortKey UPDATE, recomputes the subtitle, and publishes the full array', async () => {
    const updates: Array<Record<string, unknown>> = []
    // Query order: (1) existing {id, sortKey} rows, (2) getValue re-read.
    const db = makeFakeDb(
      [
        [
          { id: 'fv-a', sortKey: 'a0' },
          { id: 'fv-b', sortKey: 'a1' },
        ],
        // Re-read AFTER the move: b now sorts first.
        [row('fv-b', 'b@x.com', 'Zz'), row('fv-a', 'a@x.com', 'a0')],
      ],
      updates
    )
    const ctx = makeCtx(db)

    const values = await setPrimaryValue(ctx, { recordId, fieldId: FIELD_ID, valueId: 'fv-b' })

    // Returned array is the re-read, new-primary-first order.
    expect(values.map((v: any) => v.value)).toEqual(['b@x.com', 'a@x.com'])

    // Single-row move: exactly one FieldValue sortKey write, strictly BEFORE
    // the old first key under C collation, and no delete/insert.
    const sortKeyWrites = updates.filter((u) => 'sortKey' in u)
    expect(sortKeyWrites).toHaveLength(1)
    expect(typeof sortKeyWrites[0]!.sortKey).toBe('string')
    expect((sortKeyWrites[0]!.sortKey as string) < 'a0').toBe(true)

    // Subtitle recompute fired even though no VALUE was written — the
    // secondaryDisplayValue column write is the observable effect.
    const subtitleWrites = updates.filter((u) => 'secondaryDisplayValue' in u)
    expect(subtitleWrites).toHaveLength(1)

    // Publishes ONE frame carrying the FULL array (entries without a value
    // are silently dropped by the realtime layer).
    expect(mockedPublish).toHaveBeenCalledTimes(1)
    const [, organizationId, entries, options] = mockedPublish.mock.calls[0]!
    expect(organizationId).toBe(ORG)
    expect(options).toEqual({ excludeSocketId: 'socket-abc' })
    expect(entries).toHaveLength(1)
    const entry = entries[0]! as any
    expect(entry.key).toBe(buildFieldValueKey(recordId, FIELD_ID as FieldId))
    expect(Array.isArray(entry.value)).toBe(true)
    expect(entry.value.map((v: any) => v.value)).toEqual(['b@x.com', 'a@x.com'])
  })

  it('is a no-op when the target row is already primary', async () => {
    const updates: Array<Record<string, unknown>> = []
    const db = makeFakeDb(
      [
        [
          { id: 'fv-a', sortKey: 'a0' },
          { id: 'fv-b', sortKey: 'a1' },
        ],
        [row('fv-a', 'a@x.com', 'a0'), row('fv-b', 'b@x.com', 'a1')],
      ],
      updates
    )
    const ctx = makeCtx(db)

    const values = await setPrimaryValue(ctx, { recordId, fieldId: FIELD_ID, valueId: 'fv-a' })

    expect(values.map((v: any) => v.value)).toEqual(['a@x.com', 'b@x.com'])
    // No writes, no display recompute, no publish.
    expect(updates).toHaveLength(0)
    expect(mockedPublish).not.toHaveBeenCalled()
  })

  it('throws NotFoundError when the value row does not exist on the field', async () => {
    const db = makeFakeDb([[{ id: 'fv-a', sortKey: 'a0' }]], [])
    const ctx = makeCtx(db)

    await expect(
      setPrimaryValue(ctx, { recordId, fieldId: FIELD_ID, valueId: 'fv-missing' })
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('addValues — display recompute sees the FULL list', () => {
  beforeEach(() => {
    mockedPublish.mockReset()
    mockedPublish.mockResolvedValue(undefined)
    mockedGetCachedResource.mockReset()
    mockedGetCachedResource.mockResolvedValue(undefined)
    mockedGetCachedResources.mockReset()
    mockedGetCachedResources.mockResolvedValue([])
    mockedGetOrgCache.mockReset()
    mockedGetOrgCache.mockReturnValue({
      from: () => ({ all: async () => ({}), byId: async () => undefined }),
    })
  })

  it('appending an alias keeps the subtitle on the primary (recompute from full list, not survivors)', async () => {
    const updates: Array<Record<string, unknown>> = []
    const inserts: Array<Record<string, unknown>[]> = []
    // addValues' in-lock read of existing rows (full row shape).
    const db = makeFakeDb([[row('fv-a', 'a@x.com', 'a0')]], updates, inserts)
    const ctx = makeCtx(db)

    const result = await addValues(ctx, {
      recordId,
      fieldId: FIELD_ID,
      values: ['b@x.com'],
    })

    // Append lands at the END — primary unchanged.
    expect(result.map((v: any) => v.value)).toEqual(['a@x.com', 'b@x.com'])

    // The display recompute must have run over the FULL list: whatever shape
    // the formatter currently produces (joined array today, primary-only
    // scalar once the display-path lane lands), the PRIMARY leads — a
    // survivors-only recompute would have written the alias instead.
    const subtitleWrites = updates.filter((u) => 'secondaryDisplayValue' in u)
    expect(subtitleWrites).toHaveLength(1)
    const subtitle = subtitleWrites[0]!.secondaryDisplayValue
    const first = Array.isArray(subtitle) ? subtitle[0] : subtitle
    expect(String(first).startsWith('a@x.com')).toBe(true)

    // And the realtime frame carries the full post-state array.
    expect(mockedPublish).toHaveBeenCalledTimes(1)
    const [, , entries] = mockedPublish.mock.calls[0]!
    expect((entries[0] as any).value.map((v: any) => v.value)).toEqual(['a@x.com', 'b@x.com'])
  })
})
