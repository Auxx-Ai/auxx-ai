// apps/web/src/components/threads/realtime/use-thread-realtime.ts
'use client'

import { useCallback, useEffect } from 'react'
import { useUser } from '~/hooks/use-user'
import { usePusher } from '~/providers/pusher-provider'
import { useMessageListStore } from '../store/message-list-store'
import { useMessageStore } from '../store/message-store'
import { useThreadStore } from '../store/thread-store'
import type {
  ChatMessagesReadEvent,
  NewChatMessageEvent,
  NewSystemMessageEvent,
  SessionClosedEvent,
  SessionCreatedEvent,
} from './types'

/**
 * Hook that subscribes to Pusher realtime events and updates thread/message stores.
 * Should be used within a component that has access to PusherProvider context.
 *
 * With the derived views architecture, we no longer need to manually manipulate
 * list caches. When thread properties change, all filtered views automatically
 * update via selectors.
 *
 * This hook handles the following events:
 * - session-created: New chat session (creates a new thread)
 * - session-closed: Chat session ended
 * - new-chat-message: New message in a chat thread
 * - new-system-message: System message in a chat thread
 * - chat-messages-read: Messages marked as read
 */
export function useThreadRealtime() {
  const { pusher } = usePusher()
  const { organizationId } = useUser()

  // Store actions
  const requestThread = useThreadStore((s) => s.requestThread)
  const updateThread = useThreadStore((s) => s.updateThread)
  const invalidateAllContexts = useThreadStore((s) => s.invalidateAllContexts)

  const requestMessage = useMessageStore((s) => s.requestMessage)
  const appendMessage = useMessageListStore((s) => s.appendMessage)

  /**
   * Handle session-created event.
   * A new chat session has been created with a new thread.
   *
   * With derived views, requesting the thread will automatically make it
   * appear in the correct filtered views once loaded.
   */
  const handleSessionCreated = useCallback(
    (data: SessionCreatedEvent) => {
      console.log('[ThreadRealtime] session-created:', data.threadId)

      // Request the new thread metadata (will be batch-fetched)
      // Once loaded, derived views will automatically include it based on its properties
      requestThread(data.threadId)

      // Invalidate context pagination to ensure fresh data on next page load
      invalidateAllContexts()
    },
    [requestThread, invalidateAllContexts]
  )

  /**
   * Handle session-closed event.
   * A chat session has been closed.
   *
   * With derived views, changing the status automatically moves the thread
   * from OPEN views to ARCHIVED views.
   */
  const handleSessionClosed = useCallback(
    (data: SessionClosedEvent) => {
      console.log('[ThreadRealtime] session-closed:', data.threadId)

      // Update thread status in cache
      // Derived views automatically update - thread will disappear from OPEN views
      // and appear in ARCHIVED views
      updateThread(data.threadId, { status: 'ARCHIVED' })
    },
    [updateThread]
  )

  /**
   * Handle new-chat-message event.
   * A new message has been added to a chat thread.
   *
   * With derived views, updating lastMessageAt automatically re-sorts the thread
   * in all views that include it.
   */
  const handleNewChatMessage = useCallback(
    (data: NewChatMessageEvent) => {
      console.log('[ThreadRealtime] new-chat-message:', data.threadId)

      // Request the new message metadata
      if (data.message?.id) {
        requestMessage(data.message.id)
        appendMessage(data.threadId, data.message.id)
      }

      // Update thread's lastMessageAt and latestMessageId
      // Derived views will automatically re-sort based on new lastMessageAt
      updateThread(data.threadId, {
        lastMessageAt: data.message?.createdAt || new Date().toISOString(),
        latestMessageId: data.message?.id || null,
        isUnread: true,
      })
    },
    [requestMessage, appendMessage, updateThread]
  )

  /**
   * Handle new-system-message event.
   * A system message has been added to a chat thread.
   */
  const handleNewSystemMessage = useCallback(
    (data: NewSystemMessageEvent) => {
      console.log('[ThreadRealtime] new-system-message:', data.threadId)

      // Request the new message metadata
      if (data.message?.id) {
        requestMessage(data.message.id)
        appendMessage(data.threadId, data.message.id)
      }

      // Update thread timestamp
      // Derived views will automatically re-sort based on new lastMessageAt
      updateThread(data.threadId, {
        lastMessageAt: data.message?.createdAt || new Date().toISOString(),
        latestMessageId: data.message?.id || null,
      })
    },
    [requestMessage, appendMessage, updateThread]
  )

  /**
   * Handle chat-messages-read event.
   * Messages in a thread have been marked as read.
   */
  const handleChatMessagesRead = useCallback(
    (data: ChatMessagesReadEvent) => {
      console.log('[ThreadRealtime] chat-messages-read:', data.threadId, 'by', data.reader)

      // If an agent read the messages, mark the thread as read
      if (data.reader === 'agent') {
        updateThread(data.threadId, { isUnread: false })
      }
    },
    [updateThread]
  )

  // Subscribe to Pusher events
  useEffect(() => {
    if (!pusher || !organizationId) {
      return
    }

    const channelName = `presence-org-${organizationId}`

    // Try to get existing channel (PusherProvider should have subscribed)
    // If channel doesn't exist yet, wait for next effect run
    let channel = pusher.channel(channelName)

    if (!channel) {
      // Channel not subscribed yet - PusherProvider may still be connecting
      // Set up a short delay and retry
      const retryTimeout = setTimeout(() => {
        channel = pusher.channel(channelName)
        if (channel) {
          bindEvents(channel)
        }
      }, 500)

      return () => clearTimeout(retryTimeout)
    }

    function bindEvents(ch: typeof channel) {
      if (!ch) return

      console.log('[ThreadRealtime] Binding store update handlers to channel:', channelName)

      // Bind event handlers (these supplement the PusherProvider's React Query invalidations)
      ch.bind('session-created', handleSessionCreated)
      ch.bind('session-closed', handleSessionClosed)
      ch.bind('new-chat-message', handleNewChatMessage)
      ch.bind('new-system-message', handleNewSystemMessage)
      ch.bind('chat-messages-read', handleChatMessagesRead)
    }

    bindEvents(channel)

    // Cleanup on unmount
    return () => {
      if (channel) {
        console.log('[ThreadRealtime] Unbinding store update handlers from channel:', channelName)
        channel.unbind('session-created', handleSessionCreated)
        channel.unbind('session-closed', handleSessionClosed)
        channel.unbind('new-chat-message', handleNewChatMessage)
        channel.unbind('new-system-message', handleNewSystemMessage)
        channel.unbind('chat-messages-read', handleChatMessagesRead)
      }
    }
  }, [
    pusher,
    organizationId,
    handleSessionCreated,
    handleSessionClosed,
    handleNewChatMessage,
    handleNewSystemMessage,
    handleChatMessagesRead,
  ])
}
