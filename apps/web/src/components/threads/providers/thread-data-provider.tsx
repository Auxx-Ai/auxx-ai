// apps/web/src/components/threads/providers/thread-data-provider.tsx
'use client'

import { rooms } from '@auxx/lib/realtime/client'
import type { TaskWithRelations } from '@auxx/lib/tasks'
import type { StandaloneDraftMeta } from '@auxx/types/draft'
import type React from 'react'
import { useEffect, useRef } from 'react'
import { useMailCountsStore } from '~/components/mail/store'
import { useTaskStore } from '~/components/tasks/stores/task-store'
import { useUser } from '~/hooks/use-user'
import { useRealtimeRoom } from '~/realtime/hooks'
import { api } from '~/trpc/react'
import type { MessageMeta, ParticipantMeta, ThreadMeta } from '../store'
import { useMessageStore, useParticipantStore, useThreadStore } from '../store'
import { useBatchDrain } from './use-batch-drain'

interface ThreadDataProviderProps {
  children: React.ReactNode
}

/**
 * Orchestrates serial batch fetching for threads, messages, participants,
 * tasks, and standalone drafts. Place high in the component tree.
 *
 * Each resource gets its own drain loop (`useBatchDrain`), which fires
 * batches one at a time per resource — never concurrently — so a realtime
 * burst (channel sync, big mailbox import) cannot fan out into dozens of
 * overlapping `getByIds` mutations and trip the tRPC rate limiter.
 */
export function ThreadDataProvider({ children }: ThreadDataProviderProps) {
  const { mutateAsync: fetchThreads } = api.thread.getByIds.useMutation()
  useBatchDrain<ThreadMeta>({
    subscribePending: (cb) => useThreadStore.subscribe((s) => s.pendingIds.size, cb),
    getPendingSize: () => useThreadStore.getState().pendingIds.size,
    startBatch: () => useThreadStore.getState().startBatch(),
    completeBatch: (items, notFoundIds) =>
      useThreadStore.getState().completeBatch(items, notFoundIds),
    failBatch: (ids) => useThreadStore.getState().failBatch(ids),
    fetcher: (ids) => fetchThreads({ ids }),
    label: 'Thread',
  })

  const { mutateAsync: fetchMessages } = api.message.getByIds.useMutation()
  useBatchDrain<MessageMeta>({
    subscribePending: (cb) => useMessageStore.subscribe((s) => s.pendingIds.size, cb),
    getPendingSize: () => useMessageStore.getState().pendingIds.size,
    startBatch: () => useMessageStore.getState().startBatch(),
    completeBatch: (items, notFoundIds) =>
      useMessageStore.getState().completeBatch(items, notFoundIds),
    fetcher: (ids) => fetchMessages({ ids }),
    label: 'Message',
  })

  const { mutateAsync: fetchParticipants } = api.participant.getByIds.useMutation()
  useBatchDrain<ParticipantMeta>({
    subscribePending: (cb) => useParticipantStore.subscribe((s) => s.pendingIds.size, cb),
    getPendingSize: () => useParticipantStore.getState().pendingIds.size,
    startBatch: () => useParticipantStore.getState().startBatch(),
    completeBatch: (items, notFoundIds) =>
      useParticipantStore.getState().completeBatch(items, notFoundIds),
    fetcher: (ids) => fetchParticipants({ ids }),
    label: 'Participant',
  })

  const { mutateAsync: fetchTasks } = api.task.getByIds.useMutation()
  useBatchDrain<TaskWithRelations>({
    subscribePending: (cb) => useTaskStore.subscribe((s) => s.pendingFetchIds.size, cb),
    getPendingSize: () => useTaskStore.getState().pendingFetchIds.size,
    startBatch: () => useTaskStore.getState().startBatch(),
    completeBatch: (items, notFoundIds) =>
      useTaskStore.getState().completeBatch(items, notFoundIds),
    fetcher: (ids) => fetchTasks({ ids }),
    label: 'Task',
  })

  const { mutateAsync: fetchDrafts } = api.draft.getByIds.useMutation()
  useBatchDrain<StandaloneDraftMeta>({
    subscribePending: (cb) => useThreadStore.subscribe((s) => s.pendingDraftIds.size, cb),
    getPendingSize: () => useThreadStore.getState().pendingDraftIds.size,
    startBatch: () => useThreadStore.getState().startDraftBatch(),
    completeBatch: (items, notFoundIds) =>
      useThreadStore.getState().completeDraftBatch(items, notFoundIds),
    fetcher: (ids) => fetchDrafts({ ids }),
    label: 'Draft',
  })

  // ============================================================
  // Mail counts fetching
  // ============================================================
  const setCounts = useMailCountsStore((s) => s.setCounts)
  const utils = api.useUtils()
  const { userId } = useUser()

  // Counts are served from a Redis counter hash (one roundtrip), delta-updated
  // server-side and pushed via `counts:changed` — the poll is only a backstop.
  const { data: countsData } = api.thread.getCounts.useQuery(undefined, {
    refetchInterval: 15 * 60 * 1000, // 15 minutes (backstop)
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (countsData) {
      setCounts(countsData)
    }
  }, [countsData, setCounts])

  // Server pings the user room after counter deltas / reconciles (debounced
  // server-side per process). The local debounce coalesces multi-process
  // pings; the refetch itself is a single Redis read, so this stays cheap.
  const countsInvalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useRealtimeRoom(userId ? rooms.user(userId) : null, {
    onEvent: (event) => {
      if (event !== 'counts:changed' || countsInvalidateTimer.current) return
      countsInvalidateTimer.current = setTimeout(() => {
        countsInvalidateTimer.current = null
        void utils.thread.getCounts.invalidate()
      }, 1000)
    },
  })

  return <>{children}</>
}
