// apps/web/src/components/threads/realtime/use-mail-sync.ts

'use client'

import type {
  InboxSyncCompletedEvent,
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
import { rooms } from '@auxx/lib/realtime/client'
import { extractUniqueParticipantIds } from '@auxx/types'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { clearHtmlBodyCache } from '~/components/mail/hooks/use-html-body'
import { useUser } from '~/hooks/use-user'
import {
  type InboxChannelEntry,
  useInboxChannels,
  useOrgChannel,
  useRealtimeRoom,
} from '~/realtime/hooks'
import { api } from '~/trpc/react'
import { useMyInboxLenses } from '../hooks'
import { useMessageListStore } from '../store/message-list-store'
import { useMessageStore } from '../store/message-store'
import { useParticipantStore } from '../store/participant-store'
import { getThreadSelectionState } from '../store/thread-selection-store'
import { useThreadStore } from '../store/thread-store'
import { useMessageArrivalCue } from './use-message-arrival-cue'

/**
 * Mail-side counterpart to `useResourceSync`. Subscribes to the viewer's
 * per-inbox PER-LENS channels (mail-permissions §6.4) for thread/message
 * events and to their private user channel for the per-user grantee fanout +
 * `visibility:changed`, then fans events into the thread / message /
 * message-list / participant stores. Mounted once in `AuxxAppProviders`.
 */
export function useMailSync() {
  const { user } = useUser()
  const currentUserId = user?.id ?? null

  // The viewer's lens per inbox — subscribe to exactly that channel variant.
  // Admins additionally get the residual `none` (triage) channel, published
  // at `full` only. Nothing is subscribed until the lens read lands.
  const { lenses, isAdmin, isLoaded } = useMyInboxLenses()
  const entries = useMemo(() => {
    if (!isLoaded) return []
    const list: InboxChannelEntry[] = Object.entries(lenses).map(([slug, lens]) => ({
      slug,
      lens,
    }))
    if (isAdmin) list.push({ slug: 'none', lens: 'full' })
    return list
  }, [lenses, isAdmin, isLoaded])

  // Store actions (selectors to avoid re-renders).
  const requestThread = useThreadStore((s) => s.requestThread)
  const forceRequestThread = useThreadStore((s) => s.forceRequestThread)
  const setThreadPatch = useThreadStore((s) => s.setThreadPatch)
  const removeThread = useThreadStore((s) => s.removeThread)
  const invalidateAllContexts = useThreadStore((s) => s.invalidateAllContexts)

  const requestMessage = useMessageStore((s) => s.requestMessage)
  const updateMessage = useMessageStore((s) => s.updateMessage)
  const removeMessage = useMessageStore((s) => s.removeMessage)

  const appendMessage = useMessageListStore((s) => s.appendMessage)
  const setMessageList = useMessageListStore((s) => s.setList)
  const removeFromMessageList = useMessageListStore((s) => s.removeMessage)
  const invalidateMessageList = useMessageListStore((s) => s.invalidate)

  const updateParticipant = useParticipantStore((s) => s.updateParticipant)
  const requestParticipant = useParticipantStore((s) => s.requestParticipant)

  const utils = api.useUtils()

  // Clickable new-message arrival cue (email + chat). Fed once the inbound
  // message lands in the store, so sender/preview/direction are available.
  const cueIncomingMessage = useMessageArrivalCue()

  const handleThreadCreated = useCallback(
    (data: ThreadCreatedEvent['data'] | null) => {
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
    (data: ThreadUpdatedEvent['data'] | null) => {
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
    (data: ThreadDeletedEvent['data'] | null) => {
      if (!data?.threadId) return
      removeThread(data.threadId)
      invalidateMessageList(data.threadId)
      utils.thread.listIds.invalidate()
    },
    [removeThread, invalidateMessageList, utils]
  )

  const handleMessageCreated = useCallback(
    (data: MessageCreatedEvent['data'] | null) => {
      if (!data?.messageId || !data?.threadId) return
      const { messageId, threadId } = data

      // If the message data is already in the store (e.g. optimistic write
      // from a local send), append immediately.
      if (useMessageStore.getState().messages.has(messageId)) {
        appendMessage(threadId, messageId)
        setThreadPatch(threadId, { latestMessageId: messageId })
        cueIncomingMessage(messageId, threadId)
        return
      }

      // Otherwise, kick off the fetch and defer the list append + thread
      // patch until the message data lands. Without this, the id sits in
      // `messageIds` with no entry in `messages` for ~50ms (batch window),
      // and `useMessages` filters it out — visible as a missing message.
      // Also tear down if the fetch resolves to not-found, so the one-shot
      // subscription doesn't leak.
      requestMessage(messageId)
      const unsub = useMessageStore.subscribe(
        (s) =>
          s.messages.has(messageId)
            ? 'found'
            : s.notFoundIds.has(messageId)
              ? 'notfound'
              : 'pending',
        (status) => {
          if (status === 'pending') return
          if (status === 'notfound') {
            unsub()
            return
          }
          appendMessage(threadId, messageId)
          setThreadPatch(threadId, { latestMessageId: messageId })
          cueIncomingMessage(messageId, threadId)
          unsub()
        }
      )
    },
    [requestMessage, appendMessage, setThreadPatch, cueIncomingMessage]
  )

  const handleMessageUpdated = useCallback(
    (data: MessageUpdatedEvent['data'] | null) => {
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
    (data: MessageDeletedEvent['data'] | null) => {
      if (!data?.messageId || !data?.threadId) return
      removeMessage(data.messageId)
      removeFromMessageList(data.threadId, data.messageId)
    },
    [removeMessage, removeFromMessageList]
  )

  // Server emits one `inbox:syncCompleted` per touched inbox at the end of a
  // sync batch (per-message events are suppressed during sync to avoid the
  // realtime → getByIds fan-out that trips the tRPC rate limiter). Refresh
  // the thread list so any new / removed threads surface; thread + message
  // data are loaded lazily on demand.
  const handleInboxSyncCompleted = useCallback(
    (_data: InboxSyncCompletedEvent['data'] | null) => {
      utils.thread.listIds.invalidate()
      invalidateAllContexts()
    },
    [utils, invalidateAllContexts]
  )

  const handleParticipantUpdated = useCallback(
    (data: ParticipantUpdatedEvent['data'] | null) => {
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
        case 'inbox:syncCompleted':
          return handleInboxSyncCompleted(e.data)
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
      handleInboxSyncCompleted,
    ]
  )

  const handleMailBatch = useCallback(
    (data: MailBatchEvent['data'] | null) => {
      if (!Array.isArray(data?.events)) return
      for (const e of data.events) dispatchEvent(e)
      // One list invalidation at the end of a bundle.
      utils.thread.listIds.invalidate()
    },
    [dispatchEvent, utils]
  )

  // Inbox-channel event dispatcher. Bound across every active per-inbox room
  // by `useInboxChannels`, and reused for the per-user grantee fanout on the
  // user channel (payloads are identical, already redacted server-side).
  const onInboxEvent = useCallback(
    (event: string, payload: unknown) => {
      switch (event) {
        case 'thread:created':
          return handleThreadCreated(payload as ThreadCreatedEvent['data'])
        case 'thread:updated':
          return handleThreadUpdated(payload as ThreadUpdatedEvent['data'])
        case 'thread:deleted':
          return handleThreadDeleted(payload as ThreadDeletedEvent['data'])
        case 'message:created':
          return handleMessageCreated(payload as MessageCreatedEvent['data'])
        case 'message:updated':
          return handleMessageUpdated(payload as MessageUpdatedEvent['data'])
        case 'message:deleted':
          return handleMessageDeleted(payload as MessageDeletedEvent['data'])
        case 'participant:updated':
          return handleParticipantUpdated(payload as ParticipantUpdatedEvent['data'])
        case 'mail:batch':
          return handleMailBatch(payload as MailBatchEvent['data'])
        case 'inbox:syncCompleted':
          return handleInboxSyncCompleted(payload as InboxSyncCompletedEvent['data'])
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
      handleMailBatch,
      handleInboxSyncCompleted,
    ]
  )

  // Catch-up on (re)subscribe. Pusher does NOT replay events published while a
  // channel was mid-subscribe — and inbox channels only bind after the async
  // `inbox.myLenses` query resolves, plus rebind on every reconnect and on
  // visibility changes. Messages sent in those windows never reach
  // `handleMessageCreated` and only surface on a manual refresh. So when an
  // inbox channel finishes subscribing, refetch the thread list and the
  // currently-open thread's messages to recover anything missed.
  const catchUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runCatchUp = useCallback(() => {
    utils.thread.listIds.invalidate()
    const threadId = getThreadSelectionState().activeThreadId
    if (!threadId) return
    // Force-fresh fetch (the open thread's `listByThread` query is disabled once
    // cached, so a normal invalidate wouldn't refetch). Reconcile additively —
    // append only missing ids so the view doesn't flash.
    utils.message.listByThread
      .fetch({ threadId }, { staleTime: 0 })
      .then((data) => {
        if (!data?.messages) return
        useMessageStore.getState().setMessages(data.messages)
        // Seed the list when it isn't cached yet — our fetch is the freshest
        // (forced `staleTime: 0`), so it beats `useMessages`' possibly-older
        // initial fetch and includes any gap messages. `useMessages` only
        // `setList`s when absent, so it won't clobber this. When the list is
        // already cached, merge additively (append missing ids) to avoid a
        // flash and preserve optimistic entries.
        const existing = useMessageListStore.getState().lists.get(threadId)
        if (existing) {
          for (const m of data.messages) appendMessage(threadId, m.id)
        } else {
          setMessageList(threadId, {
            messageIds: data.messages.map((m) => m.id),
            total: data.total,
            fetchedAt: Date.now(),
          })
        }
        const ids = extractUniqueParticipantIds(data.messages.flatMap((m) => m.participants))
        for (const id of ids) requestParticipant(id)
      })
      .catch(() => {
        /* best-effort recovery; next subscribe/refresh retries */
      })
  }, [utils, appendMessage, setMessageList, requestParticipant])

  // Coalesce the burst of per-inbox `onSubscribed` callbacks on load into one
  // catch-up pass.
  const handleInboxSubscribed = useCallback(() => {
    if (catchUpTimerRef.current) return
    catchUpTimerRef.current = setTimeout(() => {
      catchUpTimerRef.current = null
      runCatchUp()
    }, 250)
  }, [runCatchUp])

  useEffect(
    () => () => {
      if (catchUpTimerRef.current) clearTimeout(catchUpTimerRef.current)
    },
    []
  )

  // The viewer's visibility changed (grant added/revoked, inbox lens moved,
  // role changed). Refetch `inbox.myLenses` — the `entries` memo re-derives
  // and `useInboxChannels` resubscribes to the new per-lens channel set — and
  // refresh everything lens-dependent that's already on screen.
  //
  // Declared AFTER `runCatchUp` because it calls it. The last three statements
  // are the ones that do any work on a THREAD grant (plan 45 §1.1); the four
  // above them cannot reach the open conversation at all. Thread meta has no
  // query cache — `thread.getByIds` is a mutation, so the Zustand map holds the
  // only copy of `myLens`, and that value *is* the redaction banner — and
  // `useMessages` disables itself once `useMessageListStore` has a list. A thread
  // grant also moves no inbox lens, so `myLenses` refetches byte-identically,
  // `entryKey` is unchanged, nothing resubscribes, and the `onSubscribed` →
  // `runCatchUp` self-heal never fires. Hence calling it directly.
  const handleVisibilityChanged = useCallback(() => {
    utils.inbox.myLenses.invalidate()
    utils.thread.listIds.invalidate()
    utils.thread.getCounts.invalidate()
    invalidateAllContexts()

    // Full HTML bodies otherwise survive a revoke — the map is module-level and
    // not lens-keyed (plan 45 §1.6).
    clearHtmlBodyCache()

    // Thread META. `runCatchUp` refetches the message list and the thread LIST,
    // and neither carries `myLens`, so without this the banner never clears.
    const activeThreadId = getThreadSelectionState().activeThreadId
    if (activeThreadId) forceRequestThread(activeThreadId)

    // Message bodies: fetches past the `!cachedList` gate and OVERWRITES the
    // store, so `subject`-blanked bodies get replaced rather than merged.
    runCatchUp()
  }, [utils, invalidateAllContexts, forceRequestThread, runCatchUp])

  // Org-channel event dispatcher — broadcast visibility changes (e.g. an
  // inbox default-lens edit) that fan out to every member.
  const onOrgEvent = useCallback(
    (event: string, _payload: unknown) => {
      if (event === 'visibility:changed') handleVisibilityChanged()
    },
    [handleVisibilityChanged]
  )

  // User-channel event dispatcher: targeted visibility changes + the
  // per-user grantee/assignee mail-event fanout (§6.3).
  const onUserEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event === 'visibility:changed') return handleVisibilityChanged()
      onInboxEvent(event, payload)
    },
    [handleVisibilityChanged, onInboxEvent]
  )

  useInboxChannels(entries, {
    onEvent: onInboxEvent,
    onSubscribed: handleInboxSubscribed,
  })
  useOrgChannel({ onEvent: onOrgEvent })
  useRealtimeRoom(currentUserId ? rooms.user(currentUserId) : null, { onEvent: onUserEvent })
}
