// apps/web/src/components/threads/providers/use-batch-drain.ts
'use client'

import { useEffect, useRef } from 'react'

const COALESCE_DELAY_MS = 150

export interface BatchDrainOpts<T extends { id: string }> {
  subscribePending: (listener: (size: number) => void) => () => void
  getPendingSize: () => number
  startBatch: () => string[]
  completeBatch: (items: T[], notFoundIds: string[]) => void
  /**
   * The batch fetch itself threw (network down, 500, rate limit) — which is NOT
   * the same answer as "the server looked and these do not exist", even though
   * the default below conflates them for back-compat. Supply this wherever the
   * store does something irreversible with a not-found id: the thread store
   * EVICTS on not-found, and a dropped connection must not empty the mailbox.
   */
  failBatch?: (ids: string[]) => void
  fetcher: (ids: string[]) => Promise<T[]>
  label: string
}

/**
 * Drains a store's pending-id queue serially: the next batch fetch does not
 * start until the prior one resolves. This is what prevents realtime bursts
 * (e.g. channel sync flooding `message:created` / `thread:created`) from
 * fanning out into concurrent `getByIds` mutations and blowing through the
 * tRPC mutation rate limit.
 *
 * A 150ms coalesce window runs before the first batch so back-to-back events
 * land in the same fetch.
 */
export function useBatchDrain<T extends { id: string }>(opts: BatchDrainOpts<T>) {
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    let cancelled = false
    let draining = false

    const drain = async () => {
      if (draining || cancelled) return
      draining = true
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, COALESCE_DELAY_MS))
        if (cancelled) return

        while (!cancelled) {
          const batch = optsRef.current.startBatch()
          if (batch.length === 0) break
          try {
            const items = await optsRef.current.fetcher(batch)
            if (cancelled) break
            const foundIds = new Set(items.map((i) => i.id))
            const notFoundIds = batch.filter((id) => !foundIds.has(id))
            optsRef.current.completeBatch(items, notFoundIds)
          } catch (error) {
            console.error(`${optsRef.current.label} batch fetch failed:`, error)
            const { failBatch, completeBatch } = optsRef.current
            if (failBatch) failBatch(batch)
            else completeBatch([], batch)
          }
        }
      } finally {
        draining = false
        if (!cancelled && optsRef.current.getPendingSize() > 0) drain()
      }
    }

    const unsubscribe = optsRef.current.subscribePending((size) => {
      if (size > 0) drain()
    })

    if (optsRef.current.getPendingSize() > 0) drain()

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
}
