// apps/web/src/components/mail/chat-panel/use-thread-events.ts
'use client'

import { rooms } from '@auxx/lib/realtime/client'
import { THREAD_EVENT_TYPES } from '@auxx/lib/thread-events/client'
import { useEffect, useMemo, useState } from 'react'
import { useRealtimeRoom } from '~/realtime/hooks'
import { api } from '~/trpc/react'
import type { ChatThreadEvent, ChatThreadEventType } from './system-line'

/** All persisted thread event types — the full vocabulary, not just the frozen visitor six. */
const EVENT_TYPE_SET = new Set<string>(THREAD_EVENT_TYPES)

/**
 * Load the persisted thread lifecycle events for a chat thread and subscribe
 * to the per-thread realtime room so new events appear without polling.
 *
 * Pages arrive newest-first from `thread.listEvents` (keyset cursor, §13.4);
 * this hook flattens + reverses them so `events` is always ascending for the
 * timeline. Remaining pages auto-drain in the background (§13.4 interim), so
 * `loadOlder`/`hasOlder` exist mainly for a future scroll-sentinel alignment;
 * live events append at the newest end and never interact with the cursor.
 *
 * Returns `{ events: [] }` when `enabled` is false.
 * Dedupes by event id (the realtime publisher includes the row id +
 * createdAt in the Pusher payload).
 */
export function useChatThreadEvents({
  threadId,
  enabled,
}: {
  threadId: string | null | undefined
  enabled: boolean
}): {
  events: ChatThreadEvent[]
  loadOlder: () => void
  hasOlder: boolean
  isLoading: boolean
} {
  const query = api.thread.listEvents.useInfiniteQuery(
    { threadId: threadId ?? '' },
    {
      enabled: enabled && !!threadId,
      staleTime: 30_000,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }
  )

  // §13.4 interim: the message list itself is unpaginated, so a truncated
  // event set would silently misplace old events between old messages. Drain
  // remaining pages in the background until exhausted — event counts per
  // thread are small, and the fetching/loading guards prevent a loop. A later
  // message-pagination effort can replace this with a shared scroll sentinel.
  const { hasNextPage, isFetchingNextPage, isLoading: isQueryLoading, fetchNextPage } = query
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || isQueryLoading) return
    void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isQueryLoading, fetchNextPage])

  const [liveEvents, setLiveEvents] = useState<ChatThreadEvent[]>([])

  // Reset the live buffer when the thread changes — events from a previous
  // thread are obviously irrelevant on the new one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: threadId is the trigger; setLiveEvents is stable.
  useEffect(() => {
    setLiveEvents([])
  }, [threadId])

  const roomKey = enabled && threadId ? rooms.chatThread(threadId) : null

  useRealtimeRoom(roomKey, {
    onEvent: (eventName, payload) => {
      if (!EVENT_TYPE_SET.has(eventName)) return
      if (!payload || typeof payload !== 'object') return
      const data = payload as Record<string, unknown>
      // Server publisher tucks `id` + `createdAt` into the payload; fall
      // back to a synthetic id so dedupe still works on legacy publishes.
      const id =
        typeof data.id === 'string'
          ? data.id
          : `${eventName}:${threadId}:${data.createdAt ?? Date.now()}`
      const createdAt =
        typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString()
      setLiveEvents((prev) => {
        if (prev.some((e) => e.id === id)) return prev
        return [
          ...prev,
          {
            id,
            type: eventName as ChatThreadEventType,
            createdAt,
            actorId: typeof data.actorId === 'string' ? data.actorId : null,
            data,
          },
        ]
      })
    },
  })

  const events = useMemo<ChatThreadEvent[]>(() => {
    // Pages are each DESC and pages themselves go newest → oldest, so the flat
    // concatenation is one DESC list; reverse it once into timeline order.
    const pages = query.data?.pages ?? []
    const base: ChatThreadEvent[] = pages.flatMap((page) => page.events).reverse()
    if (liveEvents.length === 0) return base
    const seen = new Set(base.map((e) => e.id))
    const merged = [...base]
    for (const ev of liveEvents) {
      if (seen.has(ev.id)) continue
      merged.push(ev)
      seen.add(ev.id)
    }
    return merged
  }, [query.data, liveEvents])

  return {
    events,
    loadOlder: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
    },
    hasOlder: query.hasNextPage ?? false,
    isLoading: query.isLoading,
  }
}
