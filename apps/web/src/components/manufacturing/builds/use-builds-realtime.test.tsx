// apps/web/src/components/manufacturing/builds/use-builds-realtime.test.tsx

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  onEvent: undefined as ((event: string, payload: unknown) => void) | undefined,
  get: vi.fn(),
  list: vi.fn(),
  batchRun: vi.fn(),
  partItem: vi.fn(),
  ledger: vi.fn(),
}))

vi.mock('~/realtime/hooks', () => ({
  useOrgChannel: (handlers: { onEvent: (event: string, payload: unknown) => void }) => {
    h.onEvent = handlers.onEvent
    return true
  },
}))
const utils = {
  builds: {
    get: { invalidate: h.get },
    list: { invalidate: h.list },
    getBatchRun: { invalidate: h.batchRun },
  },
  mrp: { partItem: { invalidate: h.partItem } },
  ledger: { listPostingsForSource: { invalidate: h.ledger } },
}
vi.mock('~/trpc/react', () => ({ api: { useUtils: () => utils } }))

import { BUILDS_REFRESH_MS, useBuildsRealtime } from './use-builds-realtime'

const frame = (data: Record<string, unknown>) => ({
  buildIds: [],
  partIds: [],
  orderIds: [],
  batchRuns: [],
  ...data,
})

const invalidations = () =>
  [h.get, h.list, h.batchRun, h.partItem, h.ledger].map((fn) => fn.mock.calls.length)

beforeEach(() => {
  vi.useFakeTimers()
  for (const fn of [h.get, h.list, h.batchRun, h.partItem, h.ledger]) fn.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useBuildsRealtime', () => {
  it('coalesces the frames inside one window into one round of invalidation', () => {
    renderHook(() => useBuildsRealtime())
    act(() => {
      for (let i = 0; i < 5; i++) h.onEvent?.('build:changed', frame({ buildIds: [`b${i}`] }))
    })
    expect(invalidations()).toEqual([0, 0, 0, 0, 0])

    act(() => {
      vi.advanceTimersByTime(BUILDS_REFRESH_MS)
    })
    expect(invalidations()).toEqual([1, 1, 1, 1, 1])

    act(() => {
      h.onEvent?.('build:changed', frame({ buildIds: ['b9'] }))
      vi.advanceTimersByTime(BUILDS_REFRESH_MS)
    })
    expect(invalidations()).toEqual([2, 2, 2, 2, 2])
  })

  it('invalidates on a frame that names only batch runs', () => {
    renderHook(() => useBuildsRealtime())
    act(() => {
      h.onEvent?.('build:changed', frame({ batchRuns: [12] }))
      vi.advanceTimersByTime(BUILDS_REFRESH_MS)
    })
    expect(invalidations()).toEqual([1, 1, 1, 1, 1])
  })

  it('ignores other events', () => {
    renderHook(() => useBuildsRealtime())
    act(() => {
      h.onEvent?.('backflush:run', {})
      vi.advanceTimersByTime(BUILDS_REFRESH_MS)
    })
    expect(invalidations()).toEqual([0, 0, 0, 0, 0])
  })
})
