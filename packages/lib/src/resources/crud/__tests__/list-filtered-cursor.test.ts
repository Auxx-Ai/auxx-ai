// packages/lib/src/resources/crud/__tests__/list-filtered-cursor.test.ts
//
// Plan v3/02 §2.1–2.2 — the handler side of the snapshot removal: one cursor shape
// (`{ offset }`), and the count policy (`includeTotal` defaults to `offset === 0`) that
// keeps an infinite scroll from paying a `COUNT(*)` per tick.
//
// The paged query fn is mocked, so these assert the handler's own resolution only.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const paged = vi.hoisted(() => vi.fn())
const DEF_ID = vi.hoisted(() => 'edf000000000000000000001')

vi.mock('../unified-handler-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../unified-handler-queries')>()
  return { ...actual, queryEntityInstanceIdsPaged: paged }
})

// Arm 3 (plan v3/03 §5.1) is the only arm that normalizes the def id and resolves
// the member's grantee union — arms 1 and 4 are decided in memory, which is what
// the arm-4 test below asserts by needing NEITHER of these.
vi.mock('../../../cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../cache')>()
  return {
    ...actual,
    findCachedResource: vi.fn(async () => ({ id: DEF_ID, entityDefinitionId: DEF_ID })),
  }
})

vi.mock('../../../resource-access/grantee-resolution', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../resource-access/grantee-resolution')>()
  return {
    ...actual,
    resolveResourceAccessGrantees: vi.fn(async () => ({
      userId: 'user_1',
      groupIds: [],
      profileId: null,
    })),
  }
})

import { UnifiedCrudHandler } from '../unified-handler'

const handler = (capabilities?: unknown) =>
  new UnifiedCrudHandler('org_1', 'user_1', {} as never, undefined, {
    capabilities: capabilities as never,
  })

describe('UnifiedCrudHandler.listFiltered — cursor + count policy', () => {
  beforeEach(() => {
    paged.mockReset()
    paged.mockResolvedValue({ ids: ['a'], total: 1, hasMore: false })
  })

  it('offset 0 ⇒ includeTotal true (the first page pays for the COUNT)', async () => {
    await handler().listFiltered({ entityDefinitionId: DEF_ID, limit: 50 })
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ offset: 0, includeTotal: true }))
  })

  it('a deep page ⇒ includeTotal false (no COUNT per scroll tick)', async () => {
    await handler().listFiltered({ entityDefinitionId: DEF_ID, limit: 50, cursor: { offset: 50 } })
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ offset: 50, includeTotal: false }))
  })

  it('honors the top-level offset for direct lib callers', async () => {
    await handler().listFiltered({ entityDefinitionId: DEF_ID, limit: 50, offset: 100 })
    expect(paged).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 100, includeTotal: false })
    )
  })

  it('cursor.offset wins over the top-level offset', async () => {
    await handler().listFiltered({
      entityDefinitionId: DEF_ID,
      limit: 50,
      offset: 100,
      cursor: { offset: 200 },
    })
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ offset: 200 }))
  })

  it('clamps a negative offset to 0', async () => {
    await handler().listFiltered({ entityDefinitionId: DEF_ID, limit: 50, offset: -5 })
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ offset: 0, includeTotal: true }))
  })

  it('includeTotal can be forced on a deep page (the kopilot query_records shape)', async () => {
    await handler().listFiltered({
      entityDefinitionId: DEF_ID,
      limit: 50,
      offset: 50,
      includeTotal: true,
    })
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ offset: 50, includeTotal: true }))
  })

  it('passes the page result through untouched', async () => {
    paged.mockResolvedValue({ ids: ['x', 'y'], total: 7, hasMore: true })
    const r = await handler().listFiltered({ entityDefinitionId: DEF_ID })
    expect(r).toEqual({ ids: ['x', 'y'], total: 7, hasMore: true })
  })

  it('a def the viewer cannot see returns the empty result without querying', async () => {
    // Plan v3/03 §5.1 arm 4: no def view AND no per-record grants ⇒ nothing is
    // reachable, so the empty result is produced with NO query. The arm is
    // decided from the capability view alone — no def normalization, no grantee
    // resolution — which is why arm 1 and arm 4 cost nothing.
    const caps = {
      canViewEntity: vi.fn(() => false),
      hasRecordGrantsOn: vi.fn(() => false),
    }
    const r = await handler(caps).listFiltered({ entityDefinitionId: DEF_ID })
    expect(r).toEqual({ ids: [], total: 0, hasMore: false })
    expect(paged).not.toHaveBeenCalled()
  })

  it('arm 3 — a def the viewer cannot see but HOLDS grants on still queries', async () => {
    // The front door is open (`hasRecordGrantsOn`), so the page is NOT empty by
    // construction: the query runs, narrowed by the grant predicate. This is the
    // whole point of P5 — before it, `canViewEntity: false` ended the read here.
    const caps = {
      canViewEntity: vi.fn(() => false),
      hasRecordGrantsOn: vi.fn(() => true),
    }
    paged.mockResolvedValue({ ids: ['shared_1'], total: 1, hasMore: false })
    const r = await handler(caps).listFiltered({ entityDefinitionId: DEF_ID })
    expect(r).toEqual({ ids: ['shared_1'], total: 1, hasMore: false })
    expect(paged).toHaveBeenCalledTimes(1)
    // …and the predicate reached the paged query, where it joins `baseWhere` —
    // shared by the page SELECT and the COUNT, so `total` stays honest.
    expect(paged.mock.calls[0]?.[0]?.visibilityWhere).toBeDefined()
  })
})
