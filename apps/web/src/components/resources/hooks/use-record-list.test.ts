// apps/web/src/components/resources/hooks/use-record-list.test.ts
//
// `useRecordList` is served from TWO caches — the zustand record-store list and
// the tRPC infinite-query pages — and either one can be the display source. The
// bug these tests pin (plans/entity/record-list-cache-divergence-plan.md) is
// what happens when they disagree:
//
//   - the store cache DISABLES the query, so a stale store list is served
//     instead of refetching;
//   - the sync effect used to copy the query's (frequently cached, minutes-old)
//     pages back over the store list stamped `Date.now()`, which both clobbered
//     optimistic appends and re-armed the 5-minute TTL — so a list that went
//     empty stayed empty until a full page reload;
//   - `record.create` / `record.delete` exclude the acting socket from their
//     realtime frames, so the acting tab's optimistic write is its ONLY update,
//     and writing just one cache reverts on the next remount.
//
// Nothing here talks to a server: the query hook is faked so each test can set
// `data` / `dataUpdatedAt` exactly.

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Pages the faked `useInfiniteQuery` hands back (undefined = never fetched). */
  data: undefined as { pages: Array<Record<string, unknown>>; pageParams: unknown[] } | undefined,
  /** When those pages were fetched, per React Query. */
  dataUpdatedAt: 0,
  /** Every `enabled` the hook asked for, in order. */
  enabledSeen: [] as boolean[],
  /** Stand-in for the tRPC infinite-query cache `setInfiniteData` mutates. */
  cache: undefined as { pages: Array<Record<string, unknown>>; pageParams: unknown[] } | undefined,
  refetch: vi.fn(),
}))

vi.mock('~/trpc/react', () => ({
  api: {
    record: {
      listFiltered: {
        useInfiniteQuery: (_input: unknown, opts: { enabled: boolean }) => {
          h.enabledSeen.push(opts.enabled)
          return {
            data: h.data,
            dataUpdatedAt: h.dataUpdatedAt,
            isLoading: false,
            isFetchingNextPage: false,
            hasNextPage: false,
            fetchNextPage: vi.fn(),
            refetch: h.refetch,
          }
        },
      },
    },
    useUtils: () => ({
      record: {
        listFiltered: {
          setInfiniteData: (_input: unknown, updater: (prev: typeof h.cache) => typeof h.cache) => {
            h.cache = updater(h.cache)
          },
        },
      },
    }),
  },
}))

import { createListKey, EMPTY_FILTERS, EMPTY_SORTING, useRecordStore } from '../store/record-store'
import { useRecordList } from './use-record-list'

const DEF = 'def_purchase_order_line'
const NOW = 1_700_000_000_000

/** The key `useRecordList` derives for the default (no filters/sort) call. */
const LIST_KEY = createListKey(DEF, EMPTY_FILTERS, EMPTY_SORTING, undefined)

/** One `record.listFiltered` page. `total` rides on the first page only. */
function page(ids: string[], opts: { total?: number; hasMore?: boolean } = {}) {
  return { ids, total: opts.total, hasMore: opts.hasMore ?? false }
}

function pages(...list: Array<ReturnType<typeof page>>) {
  return { pages: list, pageParams: [undefined] }
}

function render(limit?: number) {
  return renderHook(() =>
    useRecordList({ entityDefinitionId: DEF, ...(limit === undefined ? {} : { limit }) })
  )
}

beforeEach(() => {
  h.data = undefined
  h.dataUpdatedAt = 0
  h.enabledSeen = []
  h.cache = undefined
  h.refetch = vi.fn()
  useRecordStore.setState({
    records: {},
    lists: {},
    pendingFetchIds: new Set(),
    loadingIds: new Set(),
    notFoundIds: new Set(),
    attemptedIds: new Set(),
  })
  vi.useRealTimers()
})

describe('store cache vs query', () => {
  it('serves a warm store cache without enabling the query', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    useRecordStore.getState().setList(LIST_KEY, {
      ids: ['a', 'b'],
      total: 2,
      fetchedAt: NOW,
      nextCursor: null,
    })

    const { result } = render()

    expect(result.current.recordIds).toEqual(['a', 'b'])
    expect(result.current.isCached).toBe(true)
    expect(h.enabledSeen.at(-1)).toBe(false)
  })

  it('re-enables the query once the store cache passes its TTL', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    useRecordStore.getState().setList(LIST_KEY, {
      ids: ['a'],
      total: 1,
      fetchedAt: NOW,
      nextCursor: null,
    })
    const warm = render()
    expect(warm.result.current.isCached).toBe(true)
    expect(h.enabledSeen.at(-1)).toBe(false)

    // 6 minutes later the cache is stale — the query must come back on.
    vi.setSystemTime(NOW + 6 * 60_000)
    h.enabledSeen = []
    render()
    expect(h.enabledSeen.at(-1)).toBe(true)
  })
})

// A cached list is shared by every reader of the same (def, filters, sorting,
// search) — `createListKey` deliberately ignores `limit`. So a PRESENCE check
// (`limit: 1`, "does this part have any subparts?") writes a one-id list under
// the same key as the tab that wants the whole BOM. Being served that list is
// terminal: the store cache disables the query, so `hasNextPage` is false and
// there is nothing left to page from.
describe('cache sufficiency', () => {
  it('refuses a partial cache too short for this reader (the presence-check poison)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    // What `part-costing-card` / `part-family-card` leave behind at limit 1.
    useRecordStore.getState().setList(LIST_KEY, {
      ids: ['a'],
      total: 12,
      fetchedAt: NOW,
      nextCursor: 'more',
    })

    const { result } = render(100)

    expect(result.current.isCached).toBe(false)
    expect(h.enabledSeen.at(-1)).toBe(true)
  })

  it('serves a COMPLETE cache whatever limit produced it', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    // The same presence check on a part that really does have one subpart.
    useRecordStore.getState().setList(LIST_KEY, {
      ids: ['a'],
      total: 1,
      fetchedAt: NOW,
      nextCursor: null,
    })

    const { result } = render(100)

    expect(result.current.recordIds).toEqual(['a'])
    expect(result.current.isCached).toBe(true)
    expect(h.enabledSeen.at(-1)).toBe(false)
  })

  it("still serves a partial cache that fills this reader's page", () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const ids = Array.from({ length: 50 }, (_, i) => `r${i}`)
    useRecordStore.getState().setList(LIST_KEY, {
      ids,
      total: 500,
      fetchedAt: NOW,
      nextCursor: 'more',
    })

    const { result } = render(50)

    expect(result.current.recordIds).toEqual(ids)
    expect(result.current.isCached).toBe(true)
    expect(h.enabledSeen.at(-1)).toBe(false)
  })
})

describe('sync effect', () => {
  it('stamps fetchedAt with the query timestamp, not Date.now()', () => {
    vi.useFakeTimers()
    // Pages fetched 6 minutes ago, served from React Query's cache on this mount.
    vi.setSystemTime(NOW + 6 * 60_000)
    h.data = pages(page(['a'], { total: 1 }))
    h.dataUpdatedAt = NOW

    render()

    const cached = useRecordStore.getState().lists[LIST_KEY]
    expect(cached?.fetchedAt).toBe(NOW)
    // …and because that timestamp is honest, the entry is already stale, so the
    // next mount refetches instead of serving it for another five minutes.
    expect(cached && NOW + 6 * 60_000 - cached.fetchedAt).toBeGreaterThan(5 * 60_000)
  })

  it('does not overwrite a store list built from the same snapshot', () => {
    vi.setSystemTime(NOW)
    // The store list already reflects `dataUpdatedAt` AND has taken an
    // optimistic append since — equal timestamps are the normal case, which is
    // why the guard is `>=` and not `>`.
    useRecordStore.getState().setList(LIST_KEY, {
      ids: ['a', 'optimistic'],
      total: 2,
      fetchedAt: NOW,
      nextCursor: null,
    })
    h.data = pages(page(['a'], { total: 1 }))
    h.dataUpdatedAt = NOW

    render()

    expect(useRecordStore.getState().lists[LIST_KEY]?.ids).toEqual(['a', 'optimistic'])
  })

  it('does write when the query snapshot is newer than the store list', () => {
    useRecordStore.getState().setList(LIST_KEY, {
      ids: ['a'],
      total: 1,
      fetchedAt: NOW,
      nextCursor: null,
    })
    h.data = pages(page(['a', 'b'], { total: 2 }))
    h.dataUpdatedAt = NOW + 1_000

    render()

    expect(useRecordStore.getState().lists[LIST_KEY]?.ids).toEqual(['a', 'b'])
  })
})

describe('appendCreated', () => {
  it('writes both caches', () => {
    h.data = pages(page(['a'], { total: 1 }))
    h.dataUpdatedAt = NOW
    h.cache = pages(page(['a'], { total: 1 }))

    const { result } = render()
    act(() => result.current.appendCreated('b'))

    expect(useRecordStore.getState().lists[LIST_KEY]?.ids).toEqual(['a', 'b'])
    expect(h.cache?.pages[0]?.ids).toEqual(['a', 'b'])
    expect(h.cache?.pages[0]?.total).toBe(2)
  })

  it('never fabricates a page when the list has never been fetched', () => {
    // 🛑 Inventing a page here would read as loaded data and suppress the first
    // real fetch forever — strictly worse than the bug this fixes.
    h.cache = undefined
    const { result } = render()
    act(() => result.current.appendCreated('b'))
    expect(h.cache).toBeUndefined()
  })

  it('is idempotent', () => {
    h.data = pages(page(['a'], { total: 1 }))
    h.dataUpdatedAt = NOW
    h.cache = pages(page(['a'], { total: 1 }))

    const { result } = render()
    act(() => {
      result.current.appendCreated('b')
      result.current.appendCreated('b')
    })

    expect(h.cache?.pages[0]?.ids).toEqual(['a', 'b'])
    expect(h.cache?.pages[0]?.total).toBe(2)
  })

  it('bumps total on the first page only', () => {
    h.cache = pages(page(['a'], { total: 3, hasMore: true }), page(['b']))
    const { result } = render()
    act(() => result.current.appendCreated('c'))

    expect(h.cache?.pages[0]?.total).toBe(4)
    expect(h.cache?.pages[1]?.total).toBeUndefined()
    // Appends land on the LAST page, where the next fetch would have put them.
    expect(h.cache?.pages[1]?.ids).toEqual(['b', 'c'])
  })

  it('preserves pageParams', () => {
    h.cache = { pages: [page(['a'], { total: 1 })], pageParams: [undefined, { offset: 100 }] }
    const { result } = render()
    act(() => result.current.appendCreated('b'))
    expect(h.cache?.pageParams).toEqual([undefined, { offset: 100 }])
  })
})

describe('removeFromList', () => {
  it('drops the id from both caches and decrements total once', () => {
    h.data = pages(page(['a', 'b'], { total: 2 }))
    h.dataUpdatedAt = NOW
    h.cache = pages(page(['a', 'b'], { total: 2 }))

    const { result } = render()
    act(() => result.current.removeFromList('b'))

    expect(useRecordStore.getState().lists[LIST_KEY]?.ids).toEqual(['a'])
    expect(h.cache?.pages[0]?.ids).toEqual(['a'])
    expect(h.cache?.pages[0]?.total).toBe(1)
  })

  it('no-ops on an id the list does not hold', () => {
    h.cache = pages(page(['a'], { total: 1 }))
    const { result } = render()
    act(() => result.current.removeFromList('zzz'))
    expect(h.cache?.pages[0]?.total).toBe(1)
  })
})
