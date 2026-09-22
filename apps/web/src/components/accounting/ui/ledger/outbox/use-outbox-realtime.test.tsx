// apps/web/src/components/accounting/ui/ledger/outbox/use-outbox-realtime.test.tsx

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const channel = vi.hoisted(() => ({
  onEvent: undefined as ((event: string, payload: unknown) => void) | undefined,
}))
const invalidateList = vi.hoisted(() => vi.fn())
const invalidateRows = vi.hoisted(() => vi.fn())
const client = vi.hoisted(() => ({ current: undefined as QueryClient | undefined }))
const invalidateCounts = vi.hoisted(() => vi.fn())

vi.mock('~/realtime/hooks', () => ({
  useOrgChannel: (handlers: { onEvent: (event: string, payload: unknown) => void }) => {
    channel.onEvent = handlers.onEvent
    return true
  },
}))
vi.mock('@trpc/react-query', () => ({
  getQueryKey: () => [['ledger', 'exportBatches', 'summaryRows'], { type: 'infinite' }],
}))
vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      ledger: {
        exportBatches: {
          list: { invalidate: invalidateList },
          summaryRows: { invalidate: invalidateRows },
        },
        listExportPostings: { invalidate: vi.fn() },
        outboxCounts: { invalidate: invalidateCounts, setData: vi.fn() },
      },
    }),
    ledger: {
      exportBatches: { summaryRows: {} },
      outboxCounts: { useQuery: () => ({ data: undefined, isFetching: false }) },
    },
  },
}))

import { RUN_IDLE_MS, useOutboxRealtime } from './use-outbox-realtime'

function wrapper({ children }: { children: ReactNode }) {
  client.current ??= new QueryClient()
  return <QueryClientProvider client={client.current}>{children}</QueryClientProvider>
}

const ROWS_KEY = [
  ['ledger', 'exportBatches', 'summaryRows'],
  { input: { tab: 'ready' }, type: 'infinite' },
]

/** Seeds the summary cache with one row whose live batch is `b1`. */
function seedRow(state: string, newCount: number) {
  client.current?.setQueryData(ROWS_KEY, {
    pageParams: [undefined],
    pages: [
      {
        total: 1,
        nextCursor: undefined,
        items: [
          {
            key: 'manual 2026-09 USD',
            newCount,
            status: 'ready',
            batch: { id: 'b1', state, attempts: 0, providerObjectUrl: null },
          },
        ],
      },
    ],
  })
}

function cachedRow() {
  const data = client.current?.getQueryData<{
    pages: Array<{ items: Array<{ status: string; batch: { state: string; attempts: number } }> }>
  }>(ROWS_KEY)
  return data?.pages[0]?.items[0]
}

function frame(batchId: string, state: string, runId = 'run_1') {
  act(() => channel.onEvent?.('exportBatch:changed', { batchId, state, runId, attempts: 1 }))
}

beforeEach(() => {
  vi.clearAllMocks()
  client.current = new QueryClient()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useOutboxRealtime run strip', () => {
  it('tallies frames and closes once every row has settled', () => {
    const { result } = renderHook(useOutboxRealtime, { wrapper })
    act(() => result.current.startRun('run_1', 2))

    frame('b1', 'sending')
    frame('b1', 'sent')
    expect(result.current.run).toMatchObject({ total: 2, sent: 1, failed: 0 })

    frame('b2', 'failed')
    expect(result.current.run).toBeNull()
  })

  it('clears on its own and refetches when no frame ever arrives', () => {
    const { result } = renderHook(useOutboxRealtime, { wrapper })
    act(() => result.current.startRun('run_1', 3))

    act(() => vi.advanceTimersByTime(RUN_IDLE_MS - 1))
    expect(result.current.run).not.toBeNull()

    act(() => vi.advanceTimersByTime(1))
    expect(result.current.run).toBeNull()
    expect(invalidateRows).toHaveBeenCalled()
    expect(invalidateList).toHaveBeenCalled()
    expect(invalidateCounts).toHaveBeenCalled()
  })

  it('restarts the quiet clock on every frame', () => {
    const { result } = renderHook(useOutboxRealtime, { wrapper })
    act(() => result.current.startRun('run_1', 3))

    act(() => vi.advanceTimersByTime(RUN_IDLE_MS - 1_000))
    frame('b1', 'sent')
    act(() => vi.advanceTimersByTime(RUN_IDLE_MS - 1_000))

    expect(result.current.run).toMatchObject({ sent: 1 })
  })
})

describe('useOutboxRealtime.watchRun', () => {
  it('reports each settled row of its run, and not a sending one or another run', () => {
    const { result } = renderHook(useOutboxRealtime, { wrapper })
    const watcher = { settle: vi.fn(), end: vi.fn() }
    act(() => {
      result.current.watchRun('run_1', watcher)
    })

    frame('b1', 'sending')
    frame('b1', 'sent')
    frame('b2', 'ready')
    frame('b3', 'failed', 'run_2')

    expect(watcher.settle.mock.calls).toEqual([['b1'], ['b2']])
  })

  it('replays settles that landed before the mutation answered', () => {
    const { result } = renderHook(useOutboxRealtime, { wrapper })
    frame('b1', 'failed')

    const watcher = { settle: vi.fn(), end: vi.fn() }
    act(() => {
      result.current.watchRun('run_1', watcher)
    })

    expect(watcher.settle).toHaveBeenCalledWith('b1')
  })

  it('ends its watchers when the strip gives up on the run', () => {
    const { result } = renderHook(useOutboxRealtime, { wrapper })
    const watcher = { settle: vi.fn(), end: vi.fn() }
    act(() => {
      result.current.startRun('run_1', 2)
      result.current.watchRun('run_1', watcher)
    })

    act(() => vi.advanceTimersByTime(RUN_IDLE_MS))

    expect(watcher.end).toHaveBeenCalledTimes(1)
  })

  it('stops reporting once unsubscribed', () => {
    const { result } = renderHook(useOutboxRealtime, { wrapper })
    const watcher = { settle: vi.fn(), end: vi.fn() }
    let stop: () => void = () => {}
    act(() => {
      stop = result.current.watchRun('run_1', watcher)
    })
    stop()

    frame('b1', 'sent')

    expect(watcher.settle).not.toHaveBeenCalled()
  })
})

describe('useOutboxRealtime summary cache', () => {
  it('patches the row holding the batch and re-derives its status', () => {
    renderHook(useOutboxRealtime, { wrapper })
    seedRow('ready', 2)

    frame('b1', 'sent')

    expect(cachedRow()).toMatchObject({ status: 'sent_new', batch: { state: 'sent', attempts: 1 } })
    expect(invalidateRows).not.toHaveBeenCalled()
  })

  it('refetches when the batch is withdrawn or not on screen', () => {
    renderHook(useOutboxRealtime, { wrapper })
    seedRow('sent', 0)

    frame('b1', 'withdrawn')
    expect(invalidateRows).toHaveBeenCalledTimes(1)
    expect(invalidateCounts).toHaveBeenCalledTimes(1)

    frame('b9', 'sent')
    expect(invalidateRows).toHaveBeenCalledTimes(2)
  })
})
