// apps/web/src/components/accounting/ui/ledger/outbox/use-outbox-realtime.ts

'use client'

import type { ExportBatchState } from '@auxx/lib/accounting/export/client'
import type { ExportBatchChangedEvent } from '@auxx/lib/realtime/client'
import { type InfiniteData, useQueryClient } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useOrgChannel } from '~/realtime/hooks'
import { api, type RouterOutputs } from '~/trpc/react'

type ListPage = RouterOutputs['ledger']['exportBatches']['list']
type ListData = InfiniteData<ListPage>
type Frame = ExportBatchChangedEvent['data']

/** The states `outboxCounts` counts by; `withdrawn` is not one. */
const COUNTED: readonly ExportBatchState[] = ['ready', 'sending', 'sent', 'failed']
type CountedState = 'ready' | 'sending' | 'sent' | 'failed'
const isCounted = (state: ExportBatchState): state is CountedState => COUNTED.includes(state)

/** One release's tally, read off the frames carrying its run id (plan 93 §3 B4). */
export interface OutboxRun {
  runId: string
  total: number
  sent: number
  failed: number
  /** Handed back to Ready without a fault - not connected, or waiting on its invoice. */
  waiting: number
}

/** Per-row callbacks for one run: `settle` as each row leaves `sending`, `end` when the run closes. */
export interface OutboxRunWatcher {
  settle: (batchId: string) => void
  end: () => void
}

interface RunState {
  runId: string
  total: number
  /** Last settled state per batch; a `sending` frame clears the entry. */
  settled: Map<string, ExportBatchState>
  startedAt: number
  lastFrameAt: number
}

/** A fast worker can settle a row before `release` answers, so recent runs' frames are kept. */
const SEEN_RUN_LIMIT = 20

/** A run with no frame for this long is closed and the list refetched - realtime may be off. */
export const RUN_IDLE_MS = 30_000

/**
 * Keeps the Outbox moving on `exportBatch:changed`: patches the row in every cached
 * `exportBatches.list` page, moves `outboxCounts` by the delta, and tallies the release
 * `startRun` names. Rows never leave a tab here - admission is the server's (brief 93 §3 B3).
 */
export function useOutboxRealtime() {
  const utils = api.useUtils()
  const queryClient = useQueryClient()
  const [run, setRun] = useState<RunState | null>(null)
  const runRef = useRef<RunState | null>(null)
  const seen = useRef(new Map<string, Map<string, ExportBatchState>>())
  const watchers = useRef(new Map<string, Set<OutboxRunWatcher>>())

  const showRun = useCallback((next: RunState | null) => {
    runRef.current = next
    setRun(next)
  }, [])

  const closeRun = useCallback(() => {
    const runId = runRef.current?.runId
    showRun(null)
    if (!runId) return
    for (const watcher of watchers.current.get(runId) ?? []) watcher.end()
    watchers.current.delete(runId)
  }, [showRun])

  const tally = useCallback(
    (frame: Frame) => {
      if (!frame.runId) return
      let settled = seen.current.get(frame.runId)
      if (!settled) {
        if (seen.current.size >= SEEN_RUN_LIMIT) {
          const oldest = seen.current.keys().next().value
          if (oldest !== undefined) seen.current.delete(oldest)
        }
        settled = new Map()
        seen.current.set(frame.runId, settled)
      }
      if (frame.state === 'sending') settled.delete(frame.batchId)
      else {
        settled.set(frame.batchId, frame.state)
        for (const watcher of watchers.current.get(frame.runId) ?? []) watcher.settle(frame.batchId)
      }

      const current = runRef.current
      if (!current || current.runId !== frame.runId) return
      if (settled.size >= current.total) return closeRun()
      showRun({ ...current, settled: new Map(settled), lastFrameAt: Date.now() })
    },
    [closeRun, showRun]
  )

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event !== 'exportBatch:changed') return
      const frame = payload as Frame
      const listKey = getQueryKey(api.ledger.exportBatches.list, undefined, 'infinite')

      let previous: ExportBatchState | null = null
      for (const [, data] of queryClient.getQueriesData<ListData>({ queryKey: listKey })) {
        for (const page of data?.pages ?? []) {
          const row = page.items.find((item) => item.id === frame.batchId)
          if (row) previous ??= row.state
        }
      }

      if (previous === null) {
        void utils.ledger.exportBatches.list.invalidate()
        void utils.ledger.outboxCounts.invalidate()
        tally(frame)
        return
      }

      queryClient.setQueriesData<ListData>({ queryKey: listKey }, (data) =>
        data ? { ...data, pages: data.pages.map((page) => patchPage(page, frame)) } : data
      )

      if (frame.state === 'withdrawn') {
        // Freed postings come back as unbuilt rows, which no frame describes.
        void utils.ledger.exportBatches.unbuilt.invalidate()
        void utils.ledger.outboxCounts.invalidate()
      } else if (previous !== frame.state) {
        const from = previous
        const to = frame.state
        utils.ledger.outboxCounts.setData(undefined, (counts) => {
          if (!counts) return counts
          const next = { ...counts }
          if (isCounted(from)) next[from] = Math.max(0, next[from] - 1)
          if (isCounted(to)) next[to] += 1
          return next
        })
      }
      tally(frame)
    },
    [queryClient, tally, utils]
  )

  useOrgChannel({ onEvent })

  const startRun = useCallback(
    (runId: string, total: number) => {
      const settled = new Map(seen.current.get(runId))
      if (total === 0 || settled.size >= total) return showRun(null)
      const now = Date.now()
      showRun({ runId, total, settled, startedAt: now, lastFrameAt: settled.size > 0 ? now : 0 })
    },
    [showRun]
  )

  /** Follow one run row by row; settles already seen are replayed at once. Returns an unsubscribe. */
  const watchRun = useCallback((runId: string, watcher: OutboxRunWatcher) => {
    let set = watchers.current.get(runId)
    if (!set) {
      set = new Set()
      watchers.current.set(runId, set)
    }
    set.add(watcher)
    for (const batchId of seen.current.get(runId)?.keys() ?? []) watcher.settle(batchId)
    return () => {
      const current = watchers.current.get(runId)
      current?.delete(watcher)
      if (current?.size === 0) watchers.current.delete(runId)
    }
  }, [])

  // The safety net for lost frames: a counts read that began after the run's last frame
  // and finds nothing sending ends it.
  const counts = api.ledger.outboxCounts.useQuery()
  const fetchStartedAt = useRef(0)
  useEffect(() => {
    if (counts.isFetching) {
      fetchStartedAt.current = Date.now()
      return
    }
    if (!run || run.lastFrameAt === 0 || fetchStartedAt.current < run.lastFrameAt) return
    if (counts.data?.sending === 0) closeRun()
  }, [counts.isFetching, counts.data, run, closeRun])

  // The net for no frames at all (realtime off, worker down): give up after a quiet spell
  // and let a refetch show the rows as they stand.
  useEffect(() => {
    if (!run) return
    const quietSince = Math.max(run.startedAt, run.lastFrameAt)
    const timer = setTimeout(
      () => {
        if (runRef.current?.runId !== run.runId) return
        closeRun()
        void utils.ledger.exportBatches.list.invalidate()
        void utils.ledger.outboxCounts.invalidate()
      },
      Math.max(0, quietSince + RUN_IDLE_MS - Date.now())
    )
    return () => clearTimeout(timer)
  }, [run, closeRun, utils])

  return { run: run ? summarise(run) : null, startRun, watchRun }
}

function patchPage(page: ListPage, frame: Frame): ListPage {
  if (!page.items.some((row) => row.id === frame.batchId)) return page
  return {
    ...page,
    items: page.items.map((row) =>
      row.id === frame.batchId
        ? {
            ...row,
            state: frame.state,
            attempts: frame.attempts,
            ...(frame.providerObjectId !== undefined && {
              providerObjectId: frame.providerObjectId,
            }),
            ...(frame.failureClass !== undefined && { failureClass: frame.failureClass }),
            ...(frame.lastError !== undefined && { lastError: frame.lastError }),
            // The deep link is the server's to build; a row no longer sent loses it.
            providerObjectUrl: frame.state === 'sent' ? row.providerObjectUrl : null,
          }
        : row
    ),
  }
}

function summarise(run: RunState): OutboxRun {
  let sent = 0
  let failed = 0
  let waiting = 0
  for (const state of run.settled.values()) {
    if (state === 'sent') sent += 1
    else if (state === 'failed') failed += 1
    else if (state === 'ready') waiting += 1
  }
  return { runId: run.runId, total: run.total, sent, failed, waiting }
}
