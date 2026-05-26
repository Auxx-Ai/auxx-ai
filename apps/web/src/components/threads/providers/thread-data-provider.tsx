// apps/web/src/components/threads/providers/thread-data-provider.tsx
'use client'

import type React from 'react'
import { useEffect } from 'react'
import { useMailCountsStore } from '~/components/mail/store'
import { useTaskStore } from '~/components/tasks/stores/task-store'
import { api } from '~/trpc/react'
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
  useBatchDrain({
    subscribePending: (cb) => useThreadStore.subscribe((s) => s.pendingIds.size, cb),
    getPendingSize: () => useThreadStore.getState().pendingIds.size,
    startBatch: () => useThreadStore.getState().startBatch(),
    completeBatch: (items, notFoundIds) =>
      useThreadStore.getState().completeBatch(items, notFoundIds),
    fetcher: (ids) => fetchThreads({ ids }),
    label: 'Thread',
  })

  const { mutateAsync: fetchMessages } = api.message.getByIds.useMutation()
  useBatchDrain({
    subscribePending: (cb) => useMessageStore.subscribe((s) => s.pendingIds.size, cb),
    getPendingSize: () => useMessageStore.getState().pendingIds.size,
    startBatch: () => useMessageStore.getState().startBatch(),
    completeBatch: (items, notFoundIds) =>
      useMessageStore.getState().completeBatch(items, notFoundIds),
    fetcher: (ids) => fetchMessages({ ids }),
    label: 'Message',
  })

  const { mutateAsync: fetchParticipants } = api.participant.getByIds.useMutation()
  useBatchDrain({
    subscribePending: (cb) => useParticipantStore.subscribe((s) => s.pendingIds.size, cb),
    getPendingSize: () => useParticipantStore.getState().pendingIds.size,
    startBatch: () => useParticipantStore.getState().startBatch(),
    completeBatch: (items, notFoundIds) =>
      useParticipantStore.getState().completeBatch(items, notFoundIds),
    fetcher: (ids) => fetchParticipants({ ids }),
    label: 'Participant',
  })

  const { mutateAsync: fetchTasks } = api.task.getByIds.useMutation()
  useBatchDrain({
    subscribePending: (cb) => useTaskStore.subscribe((s) => s.pendingFetchIds.size, cb),
    getPendingSize: () => useTaskStore.getState().pendingFetchIds.size,
    startBatch: () => useTaskStore.getState().startBatch(),
    completeBatch: (items, notFoundIds) =>
      useTaskStore.getState().completeBatch(items, notFoundIds),
    fetcher: (ids) => fetchTasks({ ids }),
    label: 'Task',
  })

  const { mutateAsync: fetchDrafts } = api.draft.getByIds.useMutation()
  useBatchDrain({
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

  const { data: countsData } = api.thread.getCounts.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (countsData) {
      setCounts(countsData)
    }
  }, [countsData, setCounts])

  return <>{children}</>
}
