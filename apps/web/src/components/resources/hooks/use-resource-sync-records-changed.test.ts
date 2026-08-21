// apps/web/src/components/resources/hooks/use-resource-sync-records-changed.test.ts
//
// Tier-2 client handling (plan events/03 §7b): a `records:changed` frame runs a
// TARGETED catch-up — only listed records already in the stores are refetched,
// with the coarse list invalidate coalesced — and `run:completed` on the org
// channel triggers the full per-def catch-up. The bar: a handler that just ran
// the full `records:invalidated` catch-up would pass a "something refetched"
// test, so the assertions here pin what must NOT be fetched.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Captured per-def record-channel dispatcher. */
  onRecordEvent: undefined as ((event: string, payload: unknown) => void) | undefined,
  /** Captured org-channel dispatcher. */
  onOrgEvent: undefined as ((event: string, payload: unknown) => void) | undefined,
  listFilteredInvalidate: vi.fn(),
  getByIdsFetch: vi.fn<(input: any, opts: any) => Promise<any>>(async () => ({})),
  refetch: vi.fn(async () => {}),
}))

vi.mock('~/realtime/hooks', () => ({
  useRecordChannels: (_defIds: readonly string[], handlers: any) => {
    h.onRecordEvent = handlers?.onEvent
  },
  useOrgChannel: (handlers?: any) => {
    h.onOrgEvent = handlers?.onEvent
    return false
  },
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
const { createListKey, getRecordStoreState } = await import('../store/record-store')
const { useFieldValueStore } = await import('../store/field-value-store')

const DEF_A = 'cmadefaaaaaaaaaaaaaaaaaa'
const DEF_B = 'cmbdefbbbbbbbbbbbbbbbbbb'

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

beforeEach(() => {
  vi.useFakeTimers()
  h.onRecordEvent = undefined
  h.onOrgEvent = undefined
  h.listFilteredInvalidate.mockClear()
  h.getByIdsFetch.mockClear()
  h.getByIdsFetch.mockImplementation(async () => ({}))
  h.refetch.mockClear()
  getRecordStoreState().clearAll()
  useFieldValueStore.getState().clearAll()
})

describe('records:changed — targeted catch-up', () => {
  it('refetches only the LISTED records that are already cached', async () => {
    seedLoadedDef(DEF_A, ['r1', 'r2', 'r3'])
    renderHook(() => useResourceSync())

    // r1 is cached and listed; r-new is listed but not cached; r3 is cached
    // but NOT listed — it must not be refetched.
    h.onRecordEvent?.('records:changed', {
      entityDefinitionId: DEF_A,
      entries: [{ recordId: 'r1' }, { recordId: 'r-new' }],
    })
    await vi.runAllTimersAsync()

    expect(h.getByIdsFetch).toHaveBeenCalledTimes(1)
    expect(h.getByIdsFetch).toHaveBeenCalledWith({ items: [`${DEF_A}:r1`] }, { staleTime: 0 })
    expect(h.refetch).toHaveBeenCalledTimes(1)
    expect(h.refetch).toHaveBeenCalledWith([{ recordId: `${DEF_A}:r1`, fieldRef: `${DEF_A}:f1` }])
    // The coalesced list invalidate is what surfaces r-new (a created row).
    expect(h.listFilteredInvalidate).toHaveBeenCalledTimes(1)
    expect(h.listFilteredInvalidate).toHaveBeenCalledWith({ entityDefinitionId: DEF_A })
  })

  it('restricts the value refetch to the entry fieldIds when present', async () => {
    seedLoadedDef(DEF_A, ['r1'])
    // A second cached cell on another field of the same record.
    useFieldValueStore
      .getState()
      .setValues([{ key: `${DEF_A}:r1:${DEF_A}:f2` as any, value: 'stale' as any }])
    renderHook(() => useResourceSync())

    h.onRecordEvent?.('records:changed', {
      entityDefinitionId: DEF_A,
      entries: [{ recordId: 'r1', fieldIds: [`${DEF_A}:f2`] }],
    })
    await vi.runAllTimersAsync()

    expect(h.refetch).toHaveBeenCalledTimes(1)
    expect(h.refetch).toHaveBeenCalledWith([{ recordId: `${DEF_A}:r1`, fieldRef: `${DEF_A}:f2` }])
  })

  it('costs only the list invalidate for a def with nothing materialized', async () => {
    renderHook(() => useResourceSync())

    h.onRecordEvent?.('records:changed', {
      entityDefinitionId: DEF_A,
      entries: [{ recordId: 'r1' }],
    })
    await vi.runAllTimersAsync()

    expect(h.getByIdsFetch).not.toHaveBeenCalled()
    expect(h.refetch).not.toHaveBeenCalled()
    expect(h.listFilteredInvalidate).toHaveBeenCalledTimes(1)
  })

  it('coalesces a chunked burst into one list invalidate per def', async () => {
    renderHook(() => useResourceSync())

    h.onRecordEvent?.('records:changed', {
      entityDefinitionId: DEF_A,
      entries: [{ recordId: 'r1' }],
      chunk: { index: 0, total: 2 },
    })
    h.onRecordEvent?.('records:changed', {
      entityDefinitionId: DEF_A,
      entries: [{ recordId: 'r2' }],
      chunk: { index: 1, total: 2 },
    })
    await vi.runAllTimersAsync()

    expect(h.listFilteredInvalidate).toHaveBeenCalledTimes(1)
  })
})

describe('run:completed — org-channel completion edge', () => {
  it('runs the full catch-up for each def in defCounts', async () => {
    seedLoadedDef(DEF_A, ['r1'])
    renderHook(() => useResourceSync())

    h.onOrgEvent?.('run:completed', {
      source: 'import',
      ref: 'job-1',
      defCounts: { [DEF_A]: 12, [DEF_B]: 0 },
    })
    await vi.runAllTimersAsync()

    // Both defs get lane 1; only the materialized one costs lanes 2–3.
    expect(h.listFilteredInvalidate).toHaveBeenCalledWith({ entityDefinitionId: DEF_A })
    expect(h.listFilteredInvalidate).toHaveBeenCalledWith({ entityDefinitionId: DEF_B })
    expect(h.getByIdsFetch).toHaveBeenCalledTimes(1)
    expect(h.getByIdsFetch).toHaveBeenCalledWith({ items: [`${DEF_A}:r1`] }, { staleTime: 0 })
  })
})
