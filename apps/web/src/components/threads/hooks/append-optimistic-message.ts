// apps/web/src/components/threads/hooks/append-optimistic-message.ts

import type { FileAttachment } from '~/components/mail/email-editor/types'
import type { api } from '~/trpc/react'
import {
  type AttachmentMeta,
  getMessageListStoreState,
  getMessageStoreState,
  getThreadStoreState,
  type MessageMeta,
} from '../store'

type Utils = ReturnType<typeof api.useUtils>

/**
 * Project a staged composer `FileAttachment` onto the display-side
 * `AttachmentMeta`. `url` stays null — downloads go through
 * `/api/attachments/{id}/download`, so a null URL is harmless. When the
 * post-send sync echoes back the server-authoritative attachment, ids match
 * and React reconciles in place.
 */
export const toAttachmentMeta = (file: FileAttachment): AttachmentMeta => ({
  id: file.id,
  name: file.name,
  mimeType: file.mimeType ?? null,
  size: file.size ?? null,
  url: null,
  inline: false,
  contentId: null,
})

/**
 * Single point of truth for "I just sent a message; apply it everywhere a
 * reader might look so the UI updates immediately."
 *
 * Writes to:
 *  - Zustand message store (additive — never drops existing entries)
 *  - Zustand message list store (appends id; no-op if the list isn't seeded yet)
 *  - tRPC `message.listByThread` query cache (keeps any future direct consumer
 *    of that query honest — `useMessages` itself goes through Zustand)
 *  - Zustand thread store (bumps `lastMessageAt` + `latestMessageId` so the
 *    inbox row re-sorts and the snippet updates without a roundtrip)
 *
 * Note: the realtime `message:created` echo is suppressed for the originating
 * tab (via `excludeSocketId`), so this helper is the only thing that surfaces
 * the new message locally until the post-send sync emits `message:updated`.
 */
export function appendOptimisticMessage(
  utils: Utils,
  threadId: string,
  message: MessageMeta
): void {
  getMessageStoreState().setMessages([message])
  getMessageListStoreState().appendMessage(threadId, message.id)

  utils.message.listByThread.setData({ threadId }, (prev) => {
    if (!prev) return prev
    if (prev.messages.some((m) => m.id === message.id)) return prev
    // The query's `MessageMeta` types `messageType` as lib's nominal `enum
    // MessageType`; the store types it as the identical string union, so the
    // two are structurally interchangeable but not assignable. Members match
    // one-for-one — see `packages/lib/src/providers/types.ts`.
    const appended = message as unknown as (typeof prev.messages)[number]
    return { messages: [...prev.messages, appended], total: prev.total + 1 }
  })

  const thread = getThreadStoreState().getThread(threadId)
  if (thread) {
    getThreadStoreState().updateThread(threadId, {
      lastMessageAt: message.sentAt ?? message.createdAt,
      latestMessageId: message.id,
    })
  }
}
