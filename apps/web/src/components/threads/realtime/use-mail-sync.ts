// apps/web/src/components/threads/realtime/use-mail-sync.ts

'use client'

import type {
  MailBatchEvent,
  MailSyncEvent,
  MessageCreatedEvent,
  MessageDeletedEvent,
  MessageUpdatedEvent,
  ParticipantUpdatedEvent,
  ThreadCreatedEvent,
  ThreadDeletedEvent,
  ThreadUpdatedEvent,
} from '@auxx/lib/realtime/client'
import { useCallback, useEffect, useMemo } from 'react'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useInboxChannels, useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'
import { useInboxes } from '../hooks'
import { useMessageListStore } from '../store/message-list-store'
import { useMessageStore } from '../store/message-store'
import { useParticipantStore } from '../store/participant-store'
import { useThreadStore } from '../store/thread-store'

/**
 * Mail-side counterpart to `useResourceSync`. Subscribes to per-inbox channels
 * for thread/message events and to the org channel for participant events,
 * then fans events into the thread / message / message-list / participant
 * stores. Mounted once in `AuxxAppProviders`.
 *
 * Gated on the `realtimeMail` feature flag — when off, the hook does nothing.
 */
export function useMailSync() {
  const { user } = useUser()
  const currentUserId = user?.id ?? null
  const { hasAccess } = useFeatureFlags()
  const realtimeMailEnabled = hasAccess('realtimeMail')

  const orgChannel = useOrgChannel()
  const { inboxes } = useInboxes()

  // Build the slug set from accessible inboxes plus the implicit `none`
  // (unassigned-triage) channel that every org member subscribes to.
  const slugs = useMemo(() => {
    const list = inboxes.map((i) => i.id)
    list.push('none')
    return list
  }, [inboxes])

  const inboxChannels = useInboxChannels(realtimeMailEnabled ? slugs : [])

  // Store actions (selectors to avoid re-renders).
  const requestThread = useThreadStore((s) => s.requestThread)
  const setThreadPatch = useThreadStore((s) => s.setThreadPatch)
  const removeThread = useThreadStore((s) => s.removeThread)
  const invalidateAllContexts = useThreadStore((s) => s.invalidateAllContexts)

  const requestMessage = useMessageStore((s) => s.requestMessage)
  const updateMessage = useMessageStore((s) => s.updateMessage)
  const removeMessage = useMessageStore((s) => s.removeMessage)

  const appendMessage = useMessageListStore((s) => s.appendMessage)
  const removeFromMessageList = useMessageListStore((s) => s.removeMessage)
  const invalidateMessageList = useMessageListStore((s) => s.invalidate)

  const updateParticipant = useParticipantStore((s) => s.updateParticipant)

  const utils = api.useUtils()

  const handleThreadCreated = useCallback(
    (raw: unknown) => {
      const data = (raw as ThreadCreatedEvent['data']) ?? null
      if (!data?.threadId) return
      requestThread(data.threadId)
      invalidateAllContexts()
      utils.thread.listIds.invalidate()
    },
    [requestThread, invalidateAllContexts, utils]
  )

  // Merge a partial patch into the cached thread via `setThreadPatch`, which
  // already skips keys with pending optimistic mutations. Drops events whose
  // `userId` belongs to a different user (per-user unread fanout).
  const handleThreadUpdated = useCallback(
    (raw: unknown) => {
      const data = (raw as ThreadUpdatedEvent['data']) ?? null
      if (!data?.threadId || !data.patch) return
      const patch = { ...(data.patch as Record<string, unknown>) }
      if (patch.userId && currentUserId && patch.userId !== currentUserId) return
      delete patch.userId
      delete patch.id
      if (Object.keys(patch).length === 0) return
      setThreadPatch(data.threadId, patch as Record<string, unknown>)
    },
    [currentUserId, setThreadPatch]
  )

  const handleThreadDeleted = useCallback(
    (raw: unknown) => {
      const data = (raw as ThreadDeletedEvent['data']) ?? null
      if (!data?.threadId) return
      removeThread(data.threadId)
      invalidateMessageList(data.threadId)
      utils.thread.listIds.invalidate()
    },
    [removeThread, invalidateMessageList, utils]
  )

  const handleMessageCreated = useCallback(
    (raw: unknown) => {
      const data = (raw as MessageCreatedEvent['data']) ?? null
      if (!data?.messageId || !data?.threadId) return
      requestMessage(data.messageId)
      appendMessage(data.threadId, data.messageId)
      // Thread metadata (lastMessageAt, latestMessageId, messageCount) lands
      // via the metadata-recompute thread:updated event published by the
      // ingest seam.
    },
    [requestMessage, appendMessage]
  )

  const handleMessageUpdated = useCallback(
    (raw: unknown) => {
      const data = (raw as MessageUpdatedEvent['data']) ?? null
      if (!data?.messageId || !data.patch) return
      const patch = { ...(data.patch as Record<string, unknown>) }
      delete patch.id
      delete patch.threadId
      if (Object.keys(patch).length === 0) return
      updateMessage(data.messageId, patch)
    },
    [updateMessage]
  )

  const handleMessageDeleted = useCallback(
    (raw: unknown) => {
      const data = (raw as MessageDeletedEvent['data']) ?? null
      if (!data?.messageId || !data?.threadId) return
      removeMessage(data.messageId)
      removeFromMessageList(data.threadId, data.messageId)
    },
    [removeMessage, removeFromMessageList]
  )

  const handleParticipantUpdated = useCallback(
    (raw: unknown) => {
      const data = (raw as ParticipantUpdatedEvent['data']) ?? null
      if (!data?.participantId || !data.patch) return
      const patch = { ...(data.patch as Record<string, unknown>) }
      delete patch.id
      if (Object.keys(patch).length === 0) return
      updateParticipant(data.participantId, patch)
    },
    [updateParticipant]
  )

  // Recursively dispatch a single mail event to its handler. Used both for
  // direct binds and for `mail:batch` frames (which carry an array).
  const dispatchEvent = useCallback(
    (e: MailSyncEvent) => {
      switch (e.event) {
        case 'thread:created':
          return handleThreadCreated(e.data)
        case 'thread:updated':
          return handleThreadUpdated(e.data)
        case 'thread:deleted':
          return handleThreadDeleted(e.data)
        case 'message:created':
          return handleMessageCreated(e.data)
        case 'message:updated':
          return handleMessageUpdated(e.data)
        case 'message:deleted':
          return handleMessageDeleted(e.data)
        case 'participant:updated':
          return handleParticipantUpdated(e.data)
        case 'mail:batch':
          for (const inner of e.data.events) dispatchEvent(inner)
          return
      }
    },
    [
      handleThreadCreated,
      handleThreadUpdated,
      handleThreadDeleted,
      handleMessageCreated,
      handleMessageUpdated,
      handleMessageDeleted,
      handleParticipantUpdated,
    ]
  )

  const handleMailBatch = useCallback(
    (raw: unknown) => {
      const data = (raw as MailBatchEvent['data']) ?? null
      if (!Array.isArray(data?.events)) return
      for (const e of data.events) dispatchEvent(e)
      // One list invalidation at the end of a bundle.
      utils.thread.listIds.invalidate()
    },
    [dispatchEvent, utils]
  )

  // Bind handlers on every active inbox channel.
  useEffect(() => {
    if (!realtimeMailEnabled) return
    const cleanups: Array<() => void> = []
    for (const channel of inboxChannels.values()) {
      channel.bind('thread:created', handleThreadCreated)
      channel.bind('thread:updated', handleThreadUpdated)
      channel.bind('thread:deleted', handleThreadDeleted)
      channel.bind('message:created', handleMessageCreated)
      channel.bind('message:updated', handleMessageUpdated)
      channel.bind('message:deleted', handleMessageDeleted)
      channel.bind('mail:batch', handleMailBatch)
      cleanups.push(() => {
        channel.unbind('thread:created', handleThreadCreated)
        channel.unbind('thread:updated', handleThreadUpdated)
        channel.unbind('thread:deleted', handleThreadDeleted)
        channel.unbind('message:created', handleMessageCreated)
        channel.unbind('message:updated', handleMessageUpdated)
        channel.unbind('message:deleted', handleMessageDeleted)
        channel.unbind('mail:batch', handleMailBatch)
      })
    }
    return () => {
      for (const c of cleanups) c()
    }
  }, [
    realtimeMailEnabled,
    inboxChannels,
    handleThreadCreated,
    handleThreadUpdated,
    handleThreadDeleted,
    handleMessageCreated,
    handleMessageUpdated,
    handleMessageDeleted,
    handleMailBatch,
  ])

  // Participant events ride on the org channel.
  useEffect(() => {
    if (!realtimeMailEnabled || !orgChannel) return
    orgChannel.bind('participant:updated', handleParticipantUpdated)
    return () => {
      orgChannel.unbind('participant:updated', handleParticipantUpdated)
    }
  }, [realtimeMailEnabled, orgChannel, handleParticipantUpdated])
}
