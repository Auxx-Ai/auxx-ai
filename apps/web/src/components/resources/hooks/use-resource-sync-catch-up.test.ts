// apps/web/src/components/resources/hooks/use-resource-sync-catch-up.test.ts
//
// P0 follow-up #1 — the record-channel catch-up.
//
// The bar this file is written to: the obvious catch-up ("invalidate every def
// on subscribe") also closes the gap, and would pass any test that only asserts
// "something was invalidated". So the first assertion here is the one that
// fails for that version — a page load that subscribes to the whole catalog
// must cost ZERO invalidations — and only then that the def the viewer is
// actually looking at is reconciled.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Captured `onDefSubscribed` from `useRecordChannels`. */
  onDefSubscribed: undefined as ((entityDefinitionId: string) => void) | undefined,
  listFilteredInvalidate: vi.fn(),
  getByIdsFetch: vi.fn<(input: any, opts: any) => Promise<any>>(async () => ({})),
  refetch: vi.fn(async () => {}),
}))

vi.mock('~/realtime/hooks', () => ({
  useRecordChannels: (_defIds: readonly string[], handlers: any) => {
    h.onDefSubscribed = handlers?.onDefSubscribed
  },
  useOrgChannel: () => false,
}))

vi.mock('../store/field-value-fetch-queue', () => ({
  fieldValueFetchQueue: { refetch: h.refetch },
}))

const utils = {
  record: {
    listFiltered: { invalidate: h.listFilteredInvalidate },
    getByIds: { fetch: h.getByIdsFetch },
  },
  resource: { list: { invalidate: vi.fn() } },
  entityDefinition: {
    getAll: { invalidate: vi.fn() },
    getBySlug: { invalidate: vi.fn() },
    getById: { invalidate: vi.fn() },
  },
}

vi.mock('~/trpc/react', () => ({ api: { useUtils: () => utils } }))

const { useResourceSync } = await import('./use-resource-sync')
const { createListKey, getRecordStoreState, useRecordStore } = await import('../store/record-store')
const { useFieldValueStore } = await import('../store/field-value-store')

const DEF_A = 'cmadefaaaaaaaaaaaaaaaaaa'
const DEF_B = 'cmbdefbbbbbbbbbbbbbbbbbb'
/** A page load subscribes to the whole catalog — this stands in for it. */
const CATALOG = [
  DEF_A,
  DEF_B,
  ...Array.from({ length: 28 }, (_, i) => `cmdef${i}00000000000000000`),
]

/** Put a def's rows, meta and cell values in the stores, as a rendered view does. */
function seedLoadedDef(entityDefinitionId: string, ids: string[]) {
  const store = getRecordStoreState()
  store.setList(createListKey(entityDefinitionId, [], []), {
    ids,
    total: ids.length,
    fetchedAt: Date.now(),
    nextCursor: null,
  })
  store.setRecords(
    entityDefinitionId,
    ids.map((id) => ({ id, displayName: `stale-${id}` }) as any)
  )
  useFieldValueStore.getState().setValues(
    ids.map((id) => ({
      key: `${entityDefinitionId}:${id}:${entityDefinitionId}:f1` as any,
      value: 'stale' as any,
    }))
  )
}

/** Every def channel binds within a few ms of the catalog landing. */
function subscribeCatalog(defIds: string[] = CATALOG) {
  for (const defId of defIds) h.onDefSubscribed?.(defId)
}

beforeEach(() => {
  vi.useFakeTimers()
  h.onDefSubscribed = undefined
  h.listFilteredInvalidate.mockClear()
  h.getByIdsFetch.mockClear()
  h.getByIdsFetch.mockImplementation(async () => ({}))
  h.refetch.mockClear()
  getRecordStoreState().clearAll()
  useFieldValueStore.getState().clearAll()
})

describe('record-channel catch-up — cost', () => {
  it('costs nothing on a cold load: 30 defs subscribe, zero invalidations', async () => {
    renderHook(() => useResourceSync())

    subscribeCatalog()
    await vi.runAllTimersAsync()

    // THE assertion. The naive per-def catch-up fires 30 here.
    expect(h.listFilteredInvalidate).not.toHaveBeenCalled()
    expect(h.getByIdsFetch).not.toHaveBeenCalled()
    expect(h.refetch).not.toHaveBeenCalled()
  })

  it('reconciles only the def the client had already loaded', async () => {
    seedLoadedDef(DEF_A, ['r1', 'r2'])
    renderHook(() => useResourceSync())

    subscribeCatalog()
    await vi.runAllTimersAsync()

    expect(h.listFilteredInvalidate).toHaveBeenCalledTimes(1)
    expect(h.listFilteredInvalidate).toHaveBeenCalledWith({ entityDefinitionId: DEF_A })
    expect(h.getByIdsFetch).toHaveBeenCalledTimes(1)
  })

  it('coalesces a repeated subscribe of the same def into one pass', async () => {
    seedLoadedDef(DEF_A, ['r1'])
    renderHook(() => useResourceSync())

    h.onDefSubscribed?.(DEF_A)
    h.onDefSubscribed?.(DEF_A)
    h.onDefSubscribed?.(DEF_A)
    await vi.runAllTimersAsync()

    expect(h.listFilteredInvalidate).toHaveBeenCalledTimes(1)
  })
})

describe('record-channel catch-up — the gap is actually closed', () => {
  it('drops the def list cache so the missed create/delete is re-pulled', async () => {
    const listKey = createListKey(DEF_A, [], [])
    seedLoadedDef(DEF_A, ['r1', 'r2'])
    renderHook(() => useResourceSync())

    subscribeCatalog()
    await vi.runAllTimersAsync()

    expect(useRecordStore.getState().lists[listKey]).toBeUndefined()
  })

  it('re-reads row meta for the cached ids and merges it without blanking the row', async () => {
    seedLoadedDef(DEF_A, ['r1', 'r2'])
    h.getByIdsFetch.mockImplementation(async () => ({
      [`${DEF_A}:r1`]: { id: 'r1', displayName: 'fresh', secondaryInfo: null, avatarUrl: null },
    }))
    renderHook(() => useResourceSync())

    subscribeCatalog()
    await vi.runAllTimersAsync()

    expect(h.getByIdsFetch).toHaveBeenCalledWith(
      { items: [`${DEF_A}:r1`, `${DEF_A}:r2`] },
      { staleTime: 0 }
    )
    // Merged in place — the row that was NOT returned keeps its cached meta
    // rather than disappearing.
    expect(useRecordStore.getState().records[DEF_A]?.get('r1')?.displayName).toBe('fresh')
    expect(useRecordStore.getState().records[DEF_A]?.get('r2')?.displayName).toBe('stale-r2')
  })

  it('force-refreshes exactly the cells it holds for that def, and no others', async () => {
    seedLoadedDef(DEF_A, ['r1'])
    seedLoadedDef(DEF_B, ['r9'])
    // DEF_B is loaded too, but only DEF_A's channel is reported as subscribed.
    renderHook(() => useResourceSync())

    h.onDefSubscribed?.(DEF_A)
    await vi.runAllTimersAsync()

    expect(h.refetch).toHaveBeenCalledTimes(1)
    expect(h.refetch).toHaveBeenCalledWith([{ recordId: `${DEF_A}:r1`, fieldRef: `${DEF_A}:f1` }])
  })
})

describe('record-channel catch-up — reconnect', () => {
  it('runs again when the channel resubscribes after a reconnect', async () => {
    seedLoadedDef(DEF_A, ['r1'])
    renderHook(() => useResourceSync())

    subscribeCatalog()
    await vi.runAllTimersAsync()
    expect(h.listFilteredInvalidate).toHaveBeenCalledTimes(1)

    // Connection drops and Pusher refires subscription_succeeded. The store
    // still holds the view, so the same gap exists and must close again.
    seedLoadedDef(DEF_A, ['r1'])
    subscribeCatalog()
    await vi.runAllTimersAsync()

    expect(h.listFilteredInvalidate).toHaveBeenCalledTimes(2)
    expect(h.refetch).toHaveBeenCalledTimes(2)
  })
})
