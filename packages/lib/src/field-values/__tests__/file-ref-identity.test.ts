// packages/lib/src/field-values/__tests__/file-ref-identity.test.ts

import { toRecordId } from '@auxx/types/resource'

// See batched-realtime-publish.test.ts for why these two barrels are mocked
// this way (leaf-module mock to dodge an import-cycle gotcha; '../../cache'
// wholesale since only getOrgCache is reached on this path).
vi.mock('../../realtime/publish-helpers', () => ({
  publishFieldValueUpdates: vi.fn(),
}))

vi.mock('../../cache', () => ({
  getCachedFieldMap: vi.fn(),
  getCachedResource: vi.fn(),
  getOrgCache: vi.fn(),
}))

import { getOrgCache } from '../../cache'
import { publishFieldValueUpdates } from '../../realtime/publish-helpers'
import { createFieldValueContext, type FieldValueContext } from '../field-value-helpers'
import { addValues, removeValues } from '../field-value-mutations'
import type { FieldValueRow } from '../types'

const mockedGetOrgCache = getOrgCache as unknown as ReturnType<typeof vi.fn>
const mockedPublish = publishFieldValueUpdates as unknown as ReturnType<typeof vi.fn>

// Minimal CustomField-shaped fixture for the FILE `photos` field. `entityDefinitionId:
// null` keeps `getField`'s `entityDefinition` null, so `maybeUpdateDisplayValue`
// short-circuits (`if (!entityDef) return`) — untested here, out of scope.
const FIELD_PHOTOS = {
  id: 'field-photos',
  type: 'FILE',
  options: {},
  entityDefinitionId: null,
  entityType: null,
  isUnique: false,
  systemAttribute: null,
}

const recordId = toRecordId('quote', 'inst-1')

/**
 * Chainable fake `Database`. Drizzle's `schema.*` column refs are undefined
 * under this repo's vitest setup (project memory), so — same as
 * batched-realtime-publish.test.ts — no assertion here depends on `.where()`
 * actually filtering; the fake ignores its arguments and this suite drives
 * behavior entirely through what `.orderBy()` / `.returning()` are seeded to
 * return.
 */
function makeFakeDb(existingRows: FieldValueRow[]) {
  let idSeq = 0
  let pendingValues: any[] = []
  const chain: any = {}
  Object.assign(chain, {
    transaction: async (fn: (tx: any) => Promise<any>) => fn(chain),
    execute: async () => undefined, // pg_advisory_xact_lock
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
          id: `fv-new-${idSeq++}`,
          createdAt: '2026-07-21T00:00:00.000Z',
          updatedAt: '2026-07-21T00:00:00.000Z',
          ...row,
        }))
      ),
    select: () => chain,
    from: () => chain,
    orderBy: () => Promise.resolve(existingRows),
    update: () => chain,
    set: () => chain,
  })
  return chain
}

function makeCtx(db: any): FieldValueContext {
  return createFieldValueContext('org-1', undefined, db, 'socket-abc')
}

function photoRow(overrides: Partial<FieldValueRow>): FieldValueRow {
  return {
    id: 'fv-existing',
    entityId: 'inst-1',
    entityDefinitionId: 'quote',
    fieldId: 'field-photos',
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
    sortKey: 'a0',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  mockedGetOrgCache.mockReset()
  mockedPublish.mockReset()
  mockedPublish.mockResolvedValue(undefined)
  mockedGetOrgCache.mockReturnValue({
    all: async () => ({}),
    from: () => ({
      all: async () => ({}),
      byId: async (id: string) => (id === 'field-photos' ? FIELD_PHOTOS : undefined),
    }),
  })
})

describe('addValues — FILE identity is `.ref`, not whole-envelope equality', () => {
  it('dedupes a bare { ref } re-add against an existing captioned row for the same file', async () => {
    const existing = photoRow({
      valueJson: { ref: 'asset:1', caption: 'Front porch', internal: false },
    })
    const db = makeFakeDb([existing])
    const ctx = makeCtx(db)

    const result = await addValues(ctx, {
      recordId,
      fieldId: 'field-photos',
      // Re-adding the same file bare (as the upload path always does) plus one
      // genuinely new file.
      values: [{ ref: 'asset:1' }, { ref: 'asset:2' }],
    })

    // Only the new file was inserted — the captioned row was not duplicated.
    expect(result).toHaveLength(2)
    const byRef = new Map(result.map((r: any) => [r.value.ref, r]))
    expect(byRef.get('asset:1')?.value).toEqual({
      ref: 'asset:1',
      caption: 'Front porch',
      internal: false,
    })
    expect(byRef.get('asset:2')?.value).toEqual({ ref: 'asset:2' })
    expect(byRef.get('asset:1')?.id).toBe('fv-existing')
  })

  it('dedupes two identical bare refs within the same add call', async () => {
    const db = makeFakeDb([])
    const ctx = makeCtx(db)

    const result = await addValues(ctx, {
      recordId,
      fieldId: 'field-photos',
      values: [{ ref: 'asset:3' }, { ref: 'asset:3' }],
    })

    expect(result).toHaveLength(1)
    expect((result[0] as any).value).toEqual({ ref: 'asset:3' })
  })
})

describe('removeValues — FILE identity is `.ref`, not whole-envelope equality', () => {
  it('does not throw when removing a bare { ref } that matches a captioned row', async () => {
    const existing = photoRow({
      valueJson: { ref: 'asset:1', caption: 'Front porch', internal: true },
    })
    const db = makeFakeDb([existing])
    const ctx = makeCtx(db)

    await expect(
      removeValues(ctx, {
        recordId,
        fieldId: 'field-photos',
        values: [{ ref: 'asset:1' }],
      })
    ).resolves.toBeUndefined()
  })

  it('builds a ref-scoped where clause distinct from whole-envelope equality for FILE', async () => {
    const existing = photoRow({
      valueJson: { ref: 'asset:1', caption: 'Front porch', internal: true },
    })
    const db = makeFakeDb([existing])
    const whereArgs: any[] = []
    db.where = (arg: any) => {
      whereArgs.push(arg)
      return db
    }
    const ctx = makeCtx(db)

    await removeValues(ctx, {
      recordId,
      fieldId: 'field-photos',
      values: [{ ref: 'asset:1' }], // bare — would NOT equal the captioned row's
      // whole valueJson via old-style jsonb equality.
    })

    // First `.where()` call is the DELETE's; a second follows from the
    // post-delete `getValue()` read (unrelated — plain entity/field/org
    // equality, no valueJson match at all).
    expect(whereArgs.length).toBeGreaterThanOrEqual(1)
    const rendered = JSON.stringify(whereArgs[0])
    // The `inArray(valueJson->>'ref', ['asset:1'])` clause carries the raw
    // `->>'ref'` SQL fragment and the bare ref as its bound param — proof the
    // match is ref-scoped, not a whole-object jsonb equality check (which
    // would instead carry the JSON.stringify'd `{"ref":"asset:1"}` string).
    expect(rendered).toContain("->>'ref'")
    expect(rendered).toContain('asset:1')
    expect(rendered).not.toContain('caption')
  })
})
