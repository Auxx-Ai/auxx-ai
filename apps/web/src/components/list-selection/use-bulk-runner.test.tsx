// apps/web/src/components/list-selection/use-bulk-runner.test.tsx

import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ListSelectionProvider, useListSelection } from './store'
import { type BulkRunWatcher, ENQUEUE_IDLE_MS, useBulkRunner } from './use-bulk-runner'

const confirmResult = { value: true as boolean }
vi.mock('~/hooks/use-confirm', () => ({
  useConfirm: () => [vi.fn(async () => confirmResult.value), () => null] as const,
}))

const toastError = vi.fn()
vi.mock('@auxx/ui/components/toast', () => ({
  toastError: (args: unknown) => toastError(args),
}))

function wrapper({ children }: { children: ReactNode }) {
  return <ListSelectionProvider>{children}</ListSelectionProvider>
}

/** The hook under test plus a live view of the pending markers it writes. */
function useSubject() {
  return {
    runner: useBulkRunner(),
    pendingIds: useListSelection((s) => s.pendingIds),
    pendingLabel: useListSelection((s) => s.pendingLabel),
  }
}

const OPTS = { title: 'Remove 3 shares?', failureTitle: 'Some shares were kept' }

describe('useBulkRunner.runBatch', () => {
  beforeEach(() => {
    confirmResult.value = true
    toastError.mockClear()
  })

  it('does nothing for an empty set', async () => {
    const batchFn = vi.fn()
    const { result } = renderHook(useSubject, { wrapper })

    await act(async () => {
      await result.current.runner.runBatch([], batchFn, OPTS)
    })

    expect(batchFn).not.toHaveBeenCalled()
  })

  it('does not fire the mutation when the confirm is declined', async () => {
    confirmResult.value = false
    const batchFn = vi.fn()
    const { result } = renderHook(useSubject, { wrapper })

    await act(async () => {
      await result.current.runner.runBatch(['a', 'b'], batchFn, OPTS)
    })

    expect(batchFn).not.toHaveBeenCalled()
    expect(result.current.pendingIds).toEqual([])
  })

  it('fires exactly one mutation for the whole set and marks every id pending', async () => {
    const seen: string[][] = []
    let release: (value: { revoked: number; refused: [] }) => void = () => {}
    const inFlight = new Promise<{ revoked: number; refused: [] }>((resolve) => {
      release = resolve
    })
    const { result } = renderHook(useSubject, { wrapper })

    let settled: Promise<void> | undefined
    await act(async () => {
      settled = result.current.runner.runBatch(
        ['a', 'b', 'c'],
        async (ids) => {
          seen.push(ids)
          return inFlight
        },
        { ...OPTS, pendingLabel: 'Removing…' }
      )
    })

    // Held open by `inFlight`: the overlays are on before the round trip returns.
    expect(seen).toEqual([['a', 'b', 'c']])
    expect(result.current.pendingIds).toEqual(['a', 'b', 'c'])
    expect(result.current.runner.isRunning).toBe(true)

    await act(async () => {
      release({ revoked: 3, refused: [] })
      await settled
    })

    expect(result.current.pendingLabel).toBe('Removing…')
    // Clean delete → the markers stay until the list refetch prunes the rows.
    expect(result.current.pendingIds).toEqual(['a', 'b', 'c'])
    expect(toastError).not.toHaveBeenCalled()
  })

  it('clears the pending markers when the rows stay on screen', async () => {
    const { result } = renderHook(useSubject, { wrapper })

    await act(async () => {
      await result.current.runner.runBatch(['a', 'b'], async () => ({ revoked: 2, refused: [] }), {
        ...OPTS,
        removesItem: false,
      })
    })

    expect(result.current.pendingIds).toEqual([])
  })

  it('tolerates a mutation that returns nothing', async () => {
    const { result } = renderHook(useSubject, { wrapper })

    await act(async () => {
      await result.current.runner.runBatch(['a'], async () => undefined, OPTS)
    })

    expect(toastError).not.toHaveBeenCalled()
  })

  it('reads partial failure off the payload instead of counting throws', async () => {
    const { result } = renderHook(useSubject, { wrapper })

    await act(async () => {
      await result.current.runner.runBatch(
        ['a', 'b'],
        async () => ({
          revoked: 380,
          refused: [
            { reason: 'mail-authority', count: 20, label: 'conversations in Support need access' },
          ],
        }),
        OPTS
      )
    })

    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError.mock.calls[0]?.[0]).toEqual({
      title: 'Some shares were kept',
      // Counted off the payload (380 + 20), never off the two page ids handed in.
      description: '380 of 400 processed. 20 conversations in Support need access.',
    })
    // Refused rows survive, so no overlay may be left stranded on them.
    expect(result.current.pendingIds).toEqual([])
  })

  it('surfaces a thrown mutation once and releases every row', async () => {
    const onDone = vi.fn()
    const { result } = renderHook(useSubject, { wrapper })

    await act(async () => {
      await result.current.runner.runBatch(
        ['a', 'b'],
        async () => {
          throw new Error('nope')
        },
        { ...OPTS, onDone }
      )
    })

    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError.mock.calls[0]?.[0]).toMatchObject({
      title: 'Some shares were kept',
      description: 'nope',
    })
    expect(result.current.pendingIds).toEqual([])
    expect(onDone).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(result.current.runner.isRunning).toBe(false))
  })
})

describe('useBulkRunner.enqueue', () => {
  /** A stand-in event source: the test settles rows by hand. */
  function fakeWatch() {
    const watchers = new Map<string, BulkRunWatcher>()
    const unsubscribe = vi.fn()
    const watch = vi.fn((runId: string, watcher: BulkRunWatcher) => {
      watchers.set(runId, watcher)
      return unsubscribe
    })
    return { watch, unsubscribe, watcher: (runId: string) => watchers.get(runId) }
  }

  beforeEach(() => {
    confirmResult.value = true
    toastError.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps every row pending past the round trip and clears each as it settles', async () => {
    const source = fakeWatch()
    const onDone = vi.fn()
    const { result } = renderHook(useSubject, { wrapper })

    await act(async () => {
      await result.current.runner.enqueue(['a', 'b', 'c'], async () => ({ runId: 'run_1' }), {
        ...OPTS,
        pendingLabel: 'Retrying…',
        watch: source.watch,
        onDone,
      })
    })

    expect(source.watch).toHaveBeenCalledWith('run_1', expect.any(Object))
    expect(result.current.pendingIds).toEqual(['a', 'b', 'c'])
    expect(result.current.pendingLabel).toBe('Retrying…')
    expect(result.current.runner.isRunning).toBe(false)
    expect(onDone).toHaveBeenCalledTimes(1)

    act(() => source.watcher('run_1')?.settle('b'))
    expect(result.current.pendingIds).toEqual(['a', 'c'])

    act(() => {
      source.watcher('run_1')?.settle('a')
      source.watcher('run_1')?.settle('c')
    })
    expect(result.current.pendingIds).toEqual([])
    expect(source.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('clears at once the rows the mutation did not take', async () => {
    const source = fakeWatch()
    const { result } = renderHook(useSubject, { wrapper })

    await act(async () => {
      await result.current.runner.enqueue(
        ['a', 'b'],
        async () => ({ runId: 'run_1', released: ['a'] }),
        { ...OPTS, watch: source.watch }
      )
    })

    expect(result.current.pendingIds).toEqual(['a'])
  })

  it('clears what is left when the source ends the run', async () => {
    const source = fakeWatch()
    const { result } = renderHook(useSubject, { wrapper })

    await act(async () => {
      await result.current.runner.enqueue(['a', 'b'], async () => ({ runId: 'run_1' }), {
        ...OPTS,
        watch: source.watch,
      })
    })
    act(() => source.watcher('run_1')?.end())

    expect(result.current.pendingIds).toEqual([])
  })

  it('does not hang when no event ever arrives', async () => {
    vi.useFakeTimers()
    const source = fakeWatch()
    const { result } = renderHook(useSubject, { wrapper })

    await act(async () => {
      await result.current.runner.enqueue(['a', 'b'], async () => ({ runId: 'run_1' }), {
        ...OPTS,
        watch: source.watch,
      })
    })
    act(() => vi.advanceTimersByTime(ENQUEUE_IDLE_MS - 1))
    expect(result.current.pendingIds).toEqual(['a', 'b'])

    act(() => vi.advanceTimersByTime(1))
    expect(result.current.pendingIds).toEqual([])
    expect(source.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('restarts the quiet clock on every settle', async () => {
    vi.useFakeTimers()
    const source = fakeWatch()
    const { result } = renderHook(useSubject, { wrapper })

    await act(async () => {
      await result.current.runner.enqueue(['a', 'b'], async () => ({ runId: 'run_1' }), {
        ...OPTS,
        watch: source.watch,
        idleMs: 1_000,
      })
    })
    act(() => vi.advanceTimersByTime(900))
    act(() => source.watcher('run_1')?.settle('a'))
    act(() => vi.advanceTimersByTime(900))

    expect(result.current.pendingIds).toEqual(['b'])
  })

  it('survives a source that replays every settle before it returns', async () => {
    const unsubscribe = vi.fn()
    const { result } = renderHook(useSubject, { wrapper })

    await act(async () => {
      await result.current.runner.enqueue(['a'], async () => ({ runId: 'run_1' }), {
        ...OPTS,
        watch: (_runId, watcher) => {
          watcher.settle('a')
          return unsubscribe
        },
      })
    })

    expect(result.current.pendingIds).toEqual([])
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('clears every row and says why when the mutation fails', async () => {
    const source = fakeWatch()
    const { result } = renderHook(useSubject, { wrapper })

    await act(async () => {
      await result.current.runner.enqueue(
        ['a', 'b'],
        async () => {
          throw new Error('queue is down')
        },
        { ...OPTS, watch: source.watch }
      )
    })

    expect(result.current.pendingIds).toEqual([])
    expect(source.watch).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith({
      title: 'Some shares were kept',
      description: 'queue is down',
    })
  })
})
