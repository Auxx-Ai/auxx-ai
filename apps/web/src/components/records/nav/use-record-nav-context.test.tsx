// apps/web/src/components/records/nav/use-record-nav-context.test.tsx
//
// The hook decides which list a detail page is inside. Everything visible —
// the switcher's rows, whether the arrows work, what a shared link restores —
// falls out of that decision, so what is pinned here is the resolution ORDER
// and the two invariants the rest of the feature assumes:
//
//   * ids are append-only for the life of a descriptor (a record edited out of
//     the filter it was found under must not vanish from under the arrows), and
//   * navigation carries the query string (losing `?tab=` on every arrow press
//     would be the loudest possible regression).

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const DEF = 'edf_contact00000000000000000'
const TABLE_ID = `entity-${DEF}`

const h = vi.hoisted(() => ({
  push: vi.fn(),
  /** Current URL query, controlled per test. */
  searchParams: new URLSearchParams(),
  /** `?list=` value, controlled per test. */
  listToken: null as string | null,
  setListToken: vi.fn(),
  /** Inputs every `listFiltered.fetch` was called with. */
  fetchCalls: [] as Array<{ offset?: number; limit?: number }>,
  /** Pages the fake server hands back, in order. */
  pages: [] as Array<{ ids: string[]; total?: number; hasMore: boolean }>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => h.searchParams,
  usePathname: () => '/app/contacts/ein_a',
}))

vi.mock('nuqs', () => ({
  useQueryState: () => [h.listToken, h.setListToken],
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      record: {
        listFiltered: {
          fetch: (input: { offset?: number; limit?: number }) => {
            h.fetchCalls.push({ offset: input.offset, limit: input.limit })
            const page = h.pages.shift() ?? { ids: [], hasMore: false }
            return Promise.resolve(page)
          },
        },
      },
    }),
  },
}))

// The link builder needs a resource; the shape below is the only part read.
vi.mock('~/components/resources', () => ({
  useResource: () => ({
    resource: { id: DEF, apiSlug: 'contacts', entityType: 'contact', entityDefinitionId: DEF },
  }),
}))

vi.mock('~/components/resources/utils/get-record-link', () => ({
  getRecordLink: (recordId: string) => `/app/contacts/${recordId.split(':')[1]}`,
}))

import { useDynamicTableStore } from '~/components/dynamic-table/stores/dynamic-table-store'
import type { TableView } from '~/components/dynamic-table/types'
import {
  clearRecordListContext,
  type RecordListDescriptor,
  useRecordListContextStore,
} from './record-list-context-store'
import { useRecordNavContext } from './use-record-nav-context'

const recordId = (instanceId: string) => `${DEF}:${instanceId}` as never

function descriptor(overrides: Partial<RecordListDescriptor> = {}): RecordListDescriptor {
  return {
    entityDefinitionId: DEF,
    filters: [],
    sorting: [],
    tableId: TABLE_ID,
    viewId: 'tv_captured',
    label: 'My hot leads',
    ...overrides,
  }
}

function seedViews(views: TableView[]) {
  useDynamicTableStore.setState({
    viewsByTableId: { [TABLE_ID]: views },
    viewFilters: {},
    viewConfigs: {},
    initialized: true,
  })
}

const view = (id: string, name: string, extra: Partial<TableView> = {}): TableView =>
  ({ id, name, tableId: TABLE_ID, config: { filters: [], sorting: [] }, ...extra }) as TableView

/**
 * A captured page long enough that the open record sits outside the prefetch
 * margin. Short lists legitimately trigger a "is there more?" fetch on mount —
 * `hasMore` starts optimistic because a capture cannot say whether the surface
 * had reached the end — so tests that are not about paging use this.
 */
const IDS_20 = Array.from({ length: 20 }, (_, i) => `ein_${i}`)

beforeEach(() => {
  h.push.mockClear()
  h.setListToken.mockClear()
  h.searchParams = new URLSearchParams()
  h.listToken = null
  h.fetchCalls = []
  h.pages = []
  clearRecordListContext()
  useDynamicTableStore.setState({
    viewsByTableId: {},
    viewFilters: {},
    viewConfigs: {},
    initialized: false,
  })
})

describe('resolution order', () => {
  it('prefers the descriptor captured by a real table', () => {
    seedViews([view('tv_default', 'All contacts', { isDefault: true, isShared: true })])
    h.listToken = 'v:tv_default'
    useRecordListContextStore.getState().capture(descriptor(), IDS_20)

    const { result } = renderHook(() => useRecordNavContext(recordId('ein_0')))

    // The captured one wins over BOTH the URL token and the default view — it is
    // the only source that carries the search bar and unsaved overlays.
    expect(result.current?.descriptor.label).toBe('My hot leads')
    expect(result.current?.isReconstructed).toBe(false)
    expect(result.current?.ids).toEqual(IDS_20)
    // A warm capture costs nothing: the ids came straight off it.
    expect(h.fetchCalls).toHaveLength(0)
  })

  it('falls back to the `?list=` token when nothing was captured', async () => {
    seedViews([
      view('tv_default', 'All contacts', { isDefault: true, isShared: true }),
      view('tv_shared', 'Shared with me'),
    ])
    h.listToken = 'v:tv_shared'
    h.pages = [{ ids: ['ein_a'], total: 1, hasMore: false }]

    const { result } = renderHook(() => useRecordNavContext(recordId('ein_a')))

    await waitFor(() => expect(result.current?.descriptor.label).toBe('Shared with me'))
    expect(result.current?.isReconstructed).toBe(true)
  })

  it('falls back to the definition default view when there is no token', async () => {
    seedViews([view('tv_default', 'All contacts', { isDefault: true, isShared: true })])
    h.pages = [{ ids: ['ein_a'], total: 1, hasMore: false }]

    const { result } = renderHook(() => useRecordNavContext(recordId('ein_a')))

    await waitFor(() => expect(result.current?.descriptor.label).toBe('All contacts'))
    expect(result.current?.isReconstructed).toBe(true)
  })

  it('returns null while the view store is still hydrating', () => {
    // `initialized: false` — a cold load must show the static breadcrumb label
    // rather than flashing an empty switcher.
    const { result } = renderHook(() => useRecordNavContext(recordId('ein_a')))
    expect(result.current).toBeNull()
  })

  it('returns null when the definition has no views and nothing was captured', () => {
    seedViews([])
    const { result } = renderHook(() => useRecordNavContext(recordId('ein_a')))
    expect(result.current).toBeNull()
  })
})

describe('cold start', () => {
  it('asks for one wide window, so a deep link can locate its own index', async () => {
    seedViews([view('tv_default', 'All contacts', { isDefault: true, isShared: true })])
    h.pages = [{ ids: ['ein_a', 'ein_b', 'ein_c'], total: 3, hasMore: false }]

    const { result } = renderHook(() => useRecordNavContext(recordId('ein_b')))

    await waitFor(() => expect(result.current?.ids).toHaveLength(3))
    expect(h.fetchCalls[0]).toEqual({ offset: 0, limit: 500 })
    expect(result.current?.index).toBe(1)
    expect(result.current?.total).toBe(3)
  })
})

describe('append-only ids', () => {
  it('keeps a record that the source list dropped', () => {
    seedViews([view('tv_captured', 'My hot leads')])
    useRecordListContextStore.getState().capture(descriptor(), IDS_20)

    const { result, rerender } = renderHook(() => useRecordNavContext(recordId('ein_5')))
    expect(result.current?.index).toBe(5)

    // The table refetched and `ein_5` no longer matches the filter — e.g. the
    // user just edited its status on this very page.
    act(() => {
      useRecordListContextStore.getState().capture(
        descriptor(),
        IDS_20.filter((id) => id !== 'ein_5')
      )
    })
    rerender()

    // Membership is frozen for the life of the descriptor, so the arrows keep
    // working instead of dying under the user mid-session.
    expect(result.current?.ids).toEqual(IDS_20)
    expect(result.current?.index).toBe(5)
    expect(result.current?.hasPrev).toBe(true)
    expect(result.current?.hasNext).toBe(true)
  })
})

describe('arrows', () => {
  it('disables both ends when the record is not in the list', () => {
    seedViews([view('tv_captured', 'My hot leads')])
    useRecordListContextStore.getState().capture(descriptor(), IDS_20)

    const { result } = renderHook(() => useRecordNavContext(recordId('ein_zzz')))

    expect(result.current?.index).toBe(-1)
    expect(result.current?.hasPrev).toBe(false)
    expect(result.current?.hasNext).toBe(false)
  })

  it('disables prev at the head', () => {
    seedViews([view('tv_captured', 'My hot leads')])
    useRecordListContextStore.getState().capture(descriptor(), IDS_20)

    const { result } = renderHook(() => useRecordNavContext(recordId('ein_0')))
    expect(result.current?.hasPrev).toBe(false)
    expect(result.current?.hasNext).toBe(true)
  })

  it('disables next at the tail, once the server confirms there is no more', async () => {
    seedViews([view('tv_captured', 'My hot leads')])
    useRecordListContextStore.getState().capture(descriptor(), IDS_20)
    h.pages = [{ ids: [], hasMore: false }]

    const { result } = renderHook(() => useRecordNavContext(recordId('ein_19')))

    // Standing on the last loaded row asks for the next page first — only an
    // empty answer turns the arrow off.
    await waitFor(() => expect(result.current?.hasMore).toBe(false))
    expect(result.current?.hasNext).toBe(false)
  })

  it('carries the whole query string across the hop', () => {
    seedViews([view('tv_captured', 'My hot leads')])
    useRecordListContextStore.getState().capture(descriptor(), IDS_20)
    h.searchParams = new URLSearchParams('tab=activity&list=v%3Atv_captured')

    const { result } = renderHook(() => useRecordNavContext(recordId('ein_0')))
    act(() => result.current?.goNext())

    // `?tab=` surviving is the difference between the arrows being usable and
    // being a trap that resets the page on every press.
    expect(h.push).toHaveBeenCalledWith('/app/contacts/ein_1?tab=activity&list=v%3Atv_captured')
  })

  it('does nothing at a dead end', async () => {
    seedViews([view('tv_captured', 'My hot leads')])
    useRecordListContextStore.getState().capture(descriptor(), ['ein_only'])
    h.pages = [{ ids: [], hasMore: false }]

    const { result } = renderHook(() => useRecordNavContext(recordId('ein_only')))
    await waitFor(() => expect(result.current?.hasMore).toBe(false))

    act(() => result.current?.goPrev())
    act(() => result.current?.goNext())

    expect(h.push).not.toHaveBeenCalled()
  })
})

describe('prefetch', () => {
  it('pulls the next page when the open record nears the loaded edge', async () => {
    seedViews([view('tv_captured', 'My hot leads')])
    const ids = Array.from({ length: 10 }, (_, i) => `ein_${i}`)
    useRecordListContextStore.getState().capture(descriptor(), ids)
    h.pages = [{ ids: ['ein_10', 'ein_11'], hasMore: false }]

    // Index 7 of 10 — inside the 5-row margin.
    const { result } = renderHook(() => useRecordNavContext(recordId('ein_7')))

    await waitFor(() => expect(h.fetchCalls).toHaveLength(1))
    // Extending an existing list uses the normal page size, and resumes at the
    // end of what we already hold rather than refetching from zero.
    expect(h.fetchCalls[0]).toEqual({ offset: 10, limit: 100 })
    await waitFor(() => expect(result.current?.ids).toHaveLength(12))
  })

  it('stays quiet while the record is far from the edge', async () => {
    seedViews([view('tv_captured', 'My hot leads')])
    const ids = Array.from({ length: 30 }, (_, i) => `ein_${i}`)
    useRecordListContextStore.getState().capture(descriptor(), ids)

    renderHook(() => useRecordNavContext(recordId('ein_0')))

    await new Promise((r) => setTimeout(r, 20))
    expect(h.fetchCalls).toHaveLength(0)
  })
})

describe('the ?list= token', () => {
  it('is written for a descriptor backed by a saved view', async () => {
    seedViews([view('tv_captured', 'My hot leads')])
    useRecordListContextStore.getState().capture(descriptor(), IDS_20)

    renderHook(() => useRecordNavContext(recordId('ein_0')))

    await waitFor(() => expect(h.setListToken).toHaveBeenCalledWith('v:tv_captured'))
  })

  it('is NOT written for a session-filtered list', async () => {
    seedViews([view('tv_default', 'All contacts', { isDefault: true, isShared: true })])
    // `viewId: null` — filters that live only in this tab's session. A token
    // here would promise a reload that restores something it cannot restore.
    useRecordListContextStore
      .getState()
      .capture(descriptor({ viewId: null, label: 'Filtered' }), IDS_20)

    renderHook(() => useRecordNavContext(recordId('ein_0')))

    await new Promise((r) => setTimeout(r, 20))
    expect(h.setListToken).not.toHaveBeenCalled()
  })
})
