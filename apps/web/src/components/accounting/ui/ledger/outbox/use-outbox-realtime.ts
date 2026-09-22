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

interface RunState {
  runId: string
  total: number
  /** Last settled state per batch; a `sending` frame clears the entry. */
  settled: Map<string, ExportBatchState>
  lastFrameAt: number
}

/** A fast worker can settle a row before `release` answers, so frames are kept for a run not yet started. */
const EARLY_RUN_LIMIT = 20

/**
 * Keeps the Outbox moving on `exportBatch:changed`: patches the row in every cached
 * `exportBatches.list` page, moves `outboxCounts` by the delta, and tallies the release
 * `startRun` names. Rows never leave a tab here - admission is the server's (brief 93 §3 B3).
 */
export function useOutboxRealtime() {
  const utils = api.useUtils()
  const queryClient = useQueryClient()
  const [run, setRun] = useState<RunState | null>(null)
  const runIdRef = useRef<string | null>(null)
  const early = useRef(new Map<string, Map<string, ExportBatchState>>())

  const settleRun = useCallback((next: RunState | null) => {
    const done = next !== null && next.settled.size >= next.total
    runIdRef.current = done ? null : (next?.runId ?? null)
    setRun(done ? null : next)
  }, [])

  const tally = useCallback((frame: Frame) => {
    if (!frame.runId) return
    const apply = (settled: Map<string, ExportBatchState>) => {
      if (frame.state === 'sending') settled.delete(frame.batchId)
      else settled.set(frame.batchId, frame.state)
    }
    if (runIdRef.current !== frame.runId) {
      let buffered = early.current.get(frame.runId)
      if (!buffered) {
        if (early.current.size >= EARLY_RUN_LIMIT) early.current.clear()
        buffered = new Map()
        early.current.set(frame.runId, buffered)
      }
      apply(buffered)
      return
    }
    setRun((prev) => {
      if (!prev || prev.runId !== frame.runId) return prev
      const settled = new Map(prev.settled)
      apply(settled)
      if (settled.size >= prev.total) {
        runIdRef.current = null
        return null
      }
      return { ...prev, settled, lastFrameAt: Date.now() }
    })
  }, [])

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
      const settled = early.current.get(runId) ?? new Map<string, ExportBatchState>()
      early.current.delete(runId)
      if (total === 0) return settleRun(null)
      settleRun({ runId, total, settled, lastFrameAt: settled.size > 0 ? Date.now() : 0 })
    },
    [settleRun]
  )

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
    if (counts.data?.sending === 0) settleRun(null)
  }, [counts.isFetching, counts.data, run, settleRun])

  return { run: run ? summarise(run) : null, startRun }
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
