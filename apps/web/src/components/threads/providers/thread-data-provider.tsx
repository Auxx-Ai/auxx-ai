// apps/web/src/components/threads/providers/thread-data-provider.tsx
'use client'

import React, { useEffect } from 'react'
import { api } from '~/trpc/react'
import {
  useThreadStore,
  useMessageStore,
  useParticipantStore,
  useThreadDraftStore,
  useThreadReadStatusStore,
} from '../store'
import { useThreadRealtime } from '../realtime'

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
  const setReadStatusBatch = useThreadReadStatusStore((s) => s.setStatusBatch)

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

        // Sync read status to read-status-store for optimistic updates
        const readStatusEntries = threads.map((t) => ({
          threadId: t.id,
          isUnread: t.isUnread,
        }))
        setReadStatusBatch(readStatusEntries)
      } catch (error) {
        console.error('Thread batch fetch failed:', error)
        completeThreadBatch([], batch) // Mark all as not found on error
      }
    }, 50)

    return () => clearTimeout(timer)
  }, [pendingThreadCount, startThreadBatch, completeThreadBatch, fetchThreads, setReadStatusBatch])

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
  // Draft status batch fetching
  // ============================================================
  const pendingDraftCount = useThreadDraftStore((s) => s.pendingIds.size)
  const startDraftBatch = useThreadDraftStore((s) => s.startBatch)
  const completeDraftBatch = useThreadDraftStore((s) => s.completeBatch)

  const { mutateAsync: fetchDraftStatus } = api.thread.getThreadsWithDrafts.useMutation()

  useEffect(() => {
    if (pendingDraftCount === 0) return

    const timer = setTimeout(async () => {
      const batch = startDraftBatch()
      if (batch.length === 0) return

      try {
        // Returns array of thread IDs that have drafts
        const threadIdsWithDrafts = await fetchDraftStatus({ threadIds: batch })
        completeDraftBatch(threadIdsWithDrafts, batch)
      } catch (error) {
        console.error('Draft status batch fetch failed:', error)
        completeDraftBatch([], batch) // Mark all as no draft on error
      }
    }, 50)

    return () => clearTimeout(timer)
  }, [pendingDraftCount, startDraftBatch, completeDraftBatch, fetchDraftStatus])

  return <>{children}</>
}
