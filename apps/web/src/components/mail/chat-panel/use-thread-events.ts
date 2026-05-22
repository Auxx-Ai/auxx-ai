// apps/web/src/components/mail/chat-panel/use-thread-events.ts
'use client'

import { rooms } from '@auxx/lib/realtime/client'
import { useEffect, useMemo, useState } from 'react'
import { useRealtimeRoom } from '~/realtime/hooks'
import { api } from '~/trpc/react'
import type { ChatThreadEvent, ChatThreadEventType } from './system-line'

const EVENT_TYPES: ChatThreadEventType[] = [
  'thread:taken_over',
  'thread:returned_to_ai',
  'thread:archived',
  'thread:reopened',
  'thread:assignee:changed',
  'thread:visitor:identified',
]
const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES)

/**
 * Load the persisted thread lifecycle events for a chat thread and subscribe
 * to the per-thread realtime room so new events appear without polling.
 *
 * Returns `{ events: [] }` when `enabled` is false (e.g. email threads).
 * Dedupes by event id (the realtime publisher includes the row id +
 * createdAt in the Pusher payload).
 */
export function useChatThreadEvents({
  threadId,
  enabled,
}: {
  threadId: string | null | undefined
  enabled: boolean
}): { events: ChatThreadEvent[] } {
  const query = api.thread.listEvents.useQuery(
    { threadId: threadId ?? '' },
    { enabled: enabled && !!threadId, staleTime: 30_000 }
  )

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
            data,
          },
        ]
      })
    },
  })

  const events = useMemo<ChatThreadEvent[]>(() => {
    const base = (query.data ?? []) as ChatThreadEvent[]
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

  return { events }
}
