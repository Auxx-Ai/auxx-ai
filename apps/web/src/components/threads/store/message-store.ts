// apps/web/src/components/threads/store/message-store.ts

import '~/lib/immer-config'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'
import type { ParticipantId } from '@auxx/types'

/** Batching configuration */
const BATCH_DELAY = 50
const MAX_BATCH_SIZE = 100

/** Draft mode enum */
export type DraftMode = 'NONE' | 'PRIVATE' | 'SHARED'

/** Send status enum for outbound messages */
export type SendStatus = 'PENDING' | 'SENT' | 'FAILED'

/** Message type enum - determines how the message is rendered */
export type MessageType =
  | 'EMAIL'
  | 'FACEBOOK'
  | 'INSTAGRAM'
  | 'SMS'
  | 'WHATSAPP'
  | 'CALL'
  | 'CHAT'

/** Attachment metadata for display */
export interface AttachmentMeta {
  id: string
  name: string
  mimeType: string | null
  size: number | null
  url: string | null
}

/**
 * MessageMeta - message metadata for display.
 * Matches the backend MessageMeta type from packages/lib/src/messages/types/message-query.types.ts
 */
export interface MessageMeta {
  id: string
  threadId: string
  subject: string | null
  snippet: string | null
  textHtml: string | null
  textPlain: string | null

  isInbound: boolean
  isFirstInThread: boolean
  hasAttachments: boolean

  sentAt: string | null // ISO date
  receivedAt: string | null // ISO date
  createdAt: string // ISO date

  /** All participants as tagged IDs: ["from:abc", "to:xyz", ...] */
  participants: ParticipantId[]

  // Draft state
  draftMode: DraftMode
  createdById: string | null // User ID who created (for drafts)

  // Send status for outbound messages
  sendStatus: SendStatus | null
  providerError: string | null
  attempts: number

  // Attachments
  attachments: AttachmentMeta[]

  // Message type for rendering (EMAIL, CHAT, SMS)
  messageType: MessageType
}

/**
 * Message store state interface.
 */
interface MessageStoreState {
  messages: Map<string, MessageMeta>
  pendingIds: Set<string>
  loadingIds: Set<string>
  notFoundIds: Set<string>
  batchTimer: ReturnType<typeof setTimeout> | null

  setMessages: (messages: MessageMeta[]) => void
  updateMessage: (id: string, updates: Partial<MessageMeta>) => void
  removeMessage: (id: string) => void

  requestMessage: (id: string) => void
  startBatch: () => string[]
  completeBatch: (messages: MessageMeta[], notFoundIds: string[]) => void

  getMessage: (id: string) => MessageMeta | undefined
  isMessageLoading: (id: string) => boolean

  reset: () => void
}

/**
 * Zustand store for message metadata caching and batched lazy-loading.
 */
export const useMessageStore = create<MessageStoreState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      messages: new Map(),
      pendingIds: new Set(),
      loadingIds: new Set(),
      notFoundIds: new Set(),
      batchTimer: null,

      setMessages: (messages) =>
        set((state) => {
          for (const msg of messages) {
            state.messages.set(msg.id, msg)
            state.pendingIds.delete(msg.id)
            state.loadingIds.delete(msg.id)
            state.notFoundIds.delete(msg.id)
          }
        }),

      updateMessage: (id, updates) =>
        set((state) => {
          const existing = state.messages.get(id)
          if (existing) {
            state.messages.set(id, { ...existing, ...updates })
          }
        }),

      removeMessage: (id) =>
        set((state) => {
          state.messages.delete(id)
        }),

      requestMessage: (id) => {
        const state = get()
        if (
          state.messages.has(id) ||
          state.loadingIds.has(id) ||
          state.pendingIds.has(id) ||
          state.notFoundIds.has(id)
        ) {
          return
        }

        set((s) => {
          s.pendingIds.add(id)
        })

        if (!state.batchTimer) {
          const timer = setTimeout(() => {
            set((s) => {
              s.batchTimer = null
            })
          }, BATCH_DELAY)
          set((s) => {
            s.batchTimer = timer
          })
        }
      },

      startBatch: () => {
        const state = get()
        const batch = Array.from(state.pendingIds).slice(0, MAX_BATCH_SIZE)

        set((s) => {
          for (const id of batch) {
            s.pendingIds.delete(id)
            s.loadingIds.add(id)
          }
        })

        return batch
      },

      completeBatch: (messages, notFoundIds) =>
        set((state) => {
          for (const msg of messages) {
            state.messages.set(msg.id, msg)
            state.loadingIds.delete(msg.id)
          }
          for (const id of notFoundIds) {
            state.loadingIds.delete(id)
            state.notFoundIds.add(id)
          }
        }),

      getMessage: (id) => get().messages.get(id),

      isMessageLoading: (id) => get().loadingIds.has(id) || get().pendingIds.has(id),

      reset: () => {
        const timer = get().batchTimer
        if (timer) clearTimeout(timer)

        set((state) => {
          state.messages.clear()
          state.pendingIds.clear()
          state.loadingIds.clear()
          state.notFoundIds.clear()
          state.batchTimer = null
        })
      },
    }))
  )
)

/**
 * Get store state outside of React.
 */
export const getMessageStoreState = () => useMessageStore.getState()
