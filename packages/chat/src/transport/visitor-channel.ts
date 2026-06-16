// packages/chat/src/transport/visitor-channel.ts
//
// Per-visitor Pusher channel. Subscribes once per widget instance and fans out
// `thread-updated` / `thread-created` events to multiple listeners (Messages
// list, launcher badge, conversation view). Owns the unread-count aggregation
// so views can compute it without each re-subscribing.

import { getAllReadMap } from '~/persistence/unread'
import type { ChatConfig } from './config'
import { getChatPassport } from './passport'
import { getRealtimeClient } from './realtime-client'

export interface ThreadUpdatedEvent {
  threadId: string
  lastMessage: {
    sender: 'USER' | 'AGENT' | 'SYSTEM'
    snippet: string
    sentAt: string
  }
}

export interface ThreadCreatedEvent {
  threadId: string
  createdAt: string
}

type Listener<T> = (event: T) => void

interface VisitorChannelHandle {
  /** Subscribe to thread-updated events. Returns an unsubscribe fn. */
  onThreadUpdated: (cb: Listener<ThreadUpdatedEvent>) => () => void
  /** Subscribe to thread-created events. Returns an unsubscribe fn. */
  onThreadCreated: (cb: Listener<ThreadCreatedEvent>) => () => void
  disconnect: () => void
}

export async function connectVisitorChannel(
  channelId: string,
  config: ChatConfig
): Promise<VisitorChannelHandle> {
  const { visitorParticipantId } = await getChatPassport(channelId)
  const channelName = `private-visitor-${visitorParticipantId}`

  // Rides the widget's single shared socket. Refcounting means this is the
  // same channel object the open conversation binds lifecycle events on — no
  // second subscription.
  const sub = getRealtimeClient(channelId, config.realtime).channel(channelName)

  const updatedListeners = new Set<Listener<ThreadUpdatedEvent>>()
  const createdListeners = new Set<Listener<ThreadCreatedEvent>>()

  sub.bind('thread-updated', (data: ThreadUpdatedEvent) => {
    updatedListeners.forEach((l) => l(data))
  })
  sub.bind('thread-created', (data: ThreadCreatedEvent) => {
    createdListeners.forEach((l) => l(data))
  })

  return {
    onThreadUpdated(cb) {
      updatedListeners.add(cb)
      return () => updatedListeners.delete(cb)
    },
    onThreadCreated(cb) {
      createdListeners.add(cb)
      return () => createdListeners.delete(cb)
    },
    disconnect: () => sub.release(),
  }
}

/**
 * Compute unread count from a thread list using the local "last read at"
 * map. A thread counts as unread when its last AGENT message is newer than
 * the visitor's read-cursor for that thread.
 */
export function computeUnreadCount(
  channelId: string,
  threads: { id: string; lastMessage: { isInbound: boolean; sentAt: string } }[]
): number {
  const reads = getAllReadMap(channelId)
  let count = 0
  for (const t of threads) {
    if (t.lastMessage.isInbound) continue
    const lastReadAt = reads[t.id]
    if (!lastReadAt || new Date(t.lastMessage.sentAt) > new Date(lastReadAt)) {
      count += 1
    }
  }
  return count
}
