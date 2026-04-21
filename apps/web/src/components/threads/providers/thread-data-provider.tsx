// apps/web/src/components/threads/providers/thread-data-provider.tsx
'use client'

import type React from 'react'
import { useEffect } from 'react'
import { useMailCountsStore } from '~/components/mail/store'
import { useTaskStore } from '~/components/tasks/stores/task-store'
import { api } from '~/trpc/react'
import { useThreadRealtime } from '../realtime'
import { useMessageStore, useParticipantStore, useThreadStore } from '../store'

interface ThreadDataProviderProps {
  children: React.ReactNode
}

/**
 * Provider that orchestrates batch fetching for threads, messages, and participants.
 * Place high in component tree (e.g., app layout).
 *
 * @example
 * // In app/layout.tsx or similar
 * <ThreadDataProvider>
 *   <YourApp />
 * </ThreadDataProvider>
 */
export function ThreadDataProvider({ children }: ThreadDataProviderProps) {
  // ============================================================
  // Realtime event subscription
  // ============================================================
  useThreadRealtime()

  // ============================================================
  // Thread batch fetching
  // ============================================================
  const pendingThreadCount = useThreadStore((s) => s.pendingIds.size)
  const startThreadBatch = useThreadStore((s) => s.startBatch)
  const completeThreadBatch = useThreadStore((s) => s.completeBatch)

  const { mutateAsync: fetchThreads } = api.thread.getByIds.useMutation()

  useEffect(() => {
    if (pendingThreadCount === 0) return

    const timer = setTimeout(async () => {
      const batch = startThreadBatch()
      if (batch.length === 0) return

      try {
        const threads = await fetchThreads({ ids: batch })
        const foundIds = new Set(threads.map((t) => t.id))
        const notFoundIds = batch.filter((id) => !foundIds.has(id))
        completeThreadBatch(threads, notFoundIds)
      } catch (error) {
        console.error('Thread batch fetch failed:', error)
        completeThreadBatch([], batch) // Mark all as not found on error
      }
    }, 50)

    return () => clearTimeout(timer)
  }, [pendingThreadCount, startThreadBatch, completeThreadBatch, fetchThreads])

  // ============================================================
  // Message batch fetching
  // ============================================================
  const pendingMessageCount = useMessageStore((s) => s.pendingIds.size)
  const startMessageBatch = useMessageStore((s) => s.startBatch)
  const completeMessageBatch = useMessageStore((s) => s.completeBatch)

  const { mutateAsync: fetchMessages } = api.message.getByIds.useMutation()

  useEffect(() => {
    if (pendingMessageCount === 0) return

    const timer = setTimeout(async () => {
      const batch = startMessageBatch()
      if (batch.length === 0) return

      try {
        const messages = await fetchMessages({ ids: batch })
        const foundIds = new Set(messages.map((m) => m.id))
        const notFoundIds = batch.filter((id) => !foundIds.has(id))
        completeMessageBatch(messages, notFoundIds)
      } catch (error) {
        console.error('Message batch fetch failed:', error)
        completeMessageBatch([], batch)
      }
    }, 50)

    return () => clearTimeout(timer)
  }, [pendingMessageCount, startMessageBatch, completeMessageBatch, fetchMessages])

  // ============================================================
  // Participant batch fetching
  // ============================================================
  const pendingParticipantCount = useParticipantStore((s) => s.pendingIds.size)
  const startParticipantBatch = useParticipantStore((s) => s.startBatch)
  const completeParticipantBatch = useParticipantStore((s) => s.completeBatch)

  const { mutateAsync: fetchParticipants } = api.participant.getByIds.useMutation()

  useEffect(() => {
    if (pendingParticipantCount === 0) return

    const timer = setTimeout(async () => {
      const batch = startParticipantBatch()
      if (batch.length === 0) return

      try {
        const participants = await fetchParticipants({ ids: batch })
        const foundIds = new Set(participants.map((p) => p.id))
        const notFoundIds = batch.filter((id) => !foundIds.has(id))
        completeParticipantBatch(participants, notFoundIds)
      } catch (error) {
        console.error('Participant batch fetch failed:', error)
        completeParticipantBatch([], batch)
      }
    }, 50)

    return () => clearTimeout(timer)
  }, [pendingParticipantCount, startParticipantBatch, completeParticipantBatch, fetchParticipants])

  // ============================================================
  // Task by-id batch fetching (kopilot reference blocks)
  // ============================================================
  const pendingTaskCount = useTaskStore((s) => s.pendingFetchIds.size)
  const startTaskBatch = useTaskStore((s) => s.startBatch)
  const completeTaskBatch = useTaskStore((s) => s.completeBatch)

  const { mutateAsync: fetchTasks } = api.task.getByIds.useMutation()

  useEffect(() => {
    if (pendingTaskCount === 0) return

    const timer = setTimeout(async () => {
      const batch = startTaskBatch()
      if (batch.length === 0) return

      try {
        const tasks = await fetchTasks({ ids: batch })
        const foundIds = new Set(tasks.map((t) => t.id))
        const notFoundIds = batch.filter((id) => !foundIds.has(id))
        completeTaskBatch(tasks, notFoundIds)
      } catch (error) {
        console.error('Task batch fetch failed:', error)
        completeTaskBatch([], batch)
      }
    }, 50)

    return () => clearTimeout(timer)
  }, [pendingTaskCount, startTaskBatch, completeTaskBatch, fetchTasks])

  // ============================================================
  // Standalone draft batch fetching
  // ============================================================
  const pendingDraftCount = useThreadStore((s) => s.pendingDraftIds.size)
  const startDraftBatch = useThreadStore((s) => s.startDraftBatch)
  const completeDraftBatch = useThreadStore((s) => s.completeDraftBatch)

  const { mutateAsync: fetchDrafts } = api.draft.getByIds.useMutation()

  useEffect(() => {
    if (pendingDraftCount === 0) return

    const timer = setTimeout(async () => {
      const batch = startDraftBatch()
      if (batch.length === 0) return

      try {
        const drafts = await fetchDrafts({ ids: batch })
        const foundIds = new Set(drafts.map((d) => d.id))
        const notFoundIds = batch.filter((id) => !foundIds.has(id))
        completeDraftBatch(drafts, notFoundIds)
      } catch (error) {
        console.error('Draft batch fetch failed:', error)
        completeDraftBatch([], batch) // Mark all as not found on error
      }
    }, 50)

    return () => clearTimeout(timer)
  }, [pendingDraftCount, startDraftBatch, completeDraftBatch, fetchDrafts])

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
