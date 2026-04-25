// ~/components/mail/thread-provider.tsx
'use client'

import { type ActorId, parseActorId } from '@auxx/types/actor'
import { toRecordId } from '@auxx/types/resource'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import React, { createContext, type RefObject, useContext, useMemo } from 'react'
import type { EditorMode } from '~/components/mail/email-editor/types'
import { useThread as useThreadFromStore, useThreadMutation } from '~/components/threads/hooks'
import {
  getMessageListStoreState,
  getMessageStoreState,
  getParticipantStoreState,
} from '~/components/threads/store'
import { useReplyBox } from '~/hooks/use-reply-box'
import { api } from '~/trpc/react'

/** Reply box UI state */
interface ReplyBoxState {
  isOpen: boolean
  mode: EditorMode
  sourceMessage: any | null // Message from thread
  ref: RefObject<HTMLDivElement>
  draft: any | undefined // Draft message if exists
  isLoadingDraft: boolean
}

/** Thread mutation methods */
interface ThreadMutations {
  archiveThread: () => Promise<void>
  unarchiveThread: () => Promise<void>
  moveToTrash: () => Promise<void>
  markAsSpam: () => Promise<void>
  updateAssignee: (assigneeId: ActorId | null | undefined) => Promise<void>
  updateSubject: (subject: string) => Promise<void>
  moveToInbox: (inboxId: string) => Promise<void>
  deletePermanently: () => Promise<void>
}

/** Thread action handlers */
interface ThreadHandlers {
  updateStatus: (done: boolean) => Promise<void>
  updateAssignee: (actorId: ActorId | null | undefined) => Promise<void>
  updateSubject: (subject: string) => Promise<void>
  moveToInbox: (inboxId: string) => Promise<void>
  linkTicket: (ticketInstanceId: string | null) => Promise<void>
  createAndLinkTicket: () => Promise<string | null>
  openReplyBox: (mode: EditorMode | 'generic', message?: any) => void
  closeReplyBox: () => void
}

/** Email action handlers */
interface EmailActions {
  onReply: (message: any) => void
  onReplyAll: (message: any) => void
  onForward: (message: any) => void
  onResend: (message: any) => Promise<void>
  onDelete: (message: any) => Promise<void>
  onDownload: (message: any) => Promise<void>
  onPrint: (message: any) => void
  onCopyId: (message: any) => Promise<void>
  onViewSource: (message: any) => void
}

/**
 * ThreadContext value - provides actions and UI state only.
 * Thread DATA should be accessed via useThread from store.
 */
interface ThreadContextValue {
  // Thread ID for reference
  threadId: string

  // Reply Box State
  replyBox: ReplyBoxState

  // All Mutations
  mutations: ThreadMutations

  // Consolidated Handlers
  handlers: ThreadHandlers

  // Email Actions
  emailActions: EmailActions

  // Contact ID from URL
  contactId: string | null
}

// Create context
const ThreadContext = createContext<ThreadContextValue | null>(null)

/**
 * Signals that a `ThreadProvider` subtree is rendered *inside* another view that
 * may already own a thread context (e.g. the ticket drawer opened from the mail
 * view). Consumers can call `useIsNestedThread()` to short-circuit behaviors
 * that would otherwise collide with the outer context — reply box, global
 * keyboard shortcuts, active-thread store writes, recursive ticket controls.
 *
 * Default is `false`. Wrap the nested mount point (not `ThreadProvider`
 * itself) so only that subtree opts in.
 *
 * @example
 * <NestedThreadProvider value={true}>
 *   <RecordDrawer recordId={ticketRecordId} ... />
 * </NestedThreadProvider>
 */
const NestedThreadContext = createContext(false)
export const NestedThreadProvider = NestedThreadContext.Provider
export const useIsNestedThread = () => useContext(NestedThreadContext)

// Provider component
export function ThreadProvider({
  children,
  threadId,
}: {
  children: React.ReactNode
  threadId: string
}) {
  // When rendered inside a nested mount point (e.g. the ticket drawer opened
  // from the mail view), suppress side-effecting features that already exist
  // in the outer context: the reply box UI and (below) global keyboard
  // shortcut handling. The hook always runs, the *effects* are gated.
  const isNested = useContext(NestedThreadContext)

  // Get thread from store (for mutations that need thread data)
  const { thread } = useThreadFromStore({ threadId })

  // Get contact ID from URL
  const contactId = useMemo(() => {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    return params.get('contactId')
  }, [])

  // Initialize new unified mutation hook
  const { update, remove } = useThreadMutation()

  // Ticket creation mutation (used by createAndLinkTicket handler)
  const createTicketMutation = api.ticket.create.useMutation()

  // Force-create a contact for a participant when none is linked (used in createAndLinkTicket)
  const ensureContactMutation = api.participant.ensureContact.useMutation()

  const {
    isShowReplyBox,
    setIsShowReplyBox,
    editorMode,
    sourceMessage,
    replyBoxRef,
    openEditorForAction,
    handleShowGenericReply,
    closeWithSuppress,
    draft,
    isLoadingDraft,
  } = useReplyBox(thread)

  // Create handlers
  const handlers: ThreadHandlers = useMemo(
    () => ({
      updateStatus: async (done: boolean) => {
        if (!thread) return
        // Use optimistic update via unified hook
        update(threadId, { status: done ? 'ARCHIVED' : 'OPEN' })
      },

      updateAssignee: async (actorId: ActorId | null) => {
        // Use optimistic update via unified hook
        update(threadId, { assigneeId: actorId })
      },

      updateSubject: async (subject: string) => {
        // Use optimistic update via unified hook
        update(threadId, { subject })
      },

      moveToInbox: async (inboxId: string) => {
        // Use optimistic update via unified hook
        update(threadId, { inboxId })
        toastSuccess({ title: 'Thread moved to inbox' })
      },

      linkTicket: async (ticketInstanceId: string | null) => {
        update(threadId, {
          ticketId: ticketInstanceId ? toRecordId('ticket', ticketInstanceId) : null,
        })
      },

      createAndLinkTicket: async () => {
        if (!thread) return null

        // Pick the first inbound external sender from the message store. Skip
        // internal addresses (own-domain) and spammers.
        const messageIds = getMessageListStoreState().lists.get(threadId)?.messageIds ?? []
        const messageStore = getMessageStoreState()
        const participantStore = getParticipantStoreState()

        let participantId: string | null = null
        let contactInstanceId: string | null = null
        for (const messageId of messageIds) {
          const message = messageStore.messages.get(messageId)
          if (!message || !message.isInbound) continue
          const fromPid = message.participants.find((p) => p.startsWith('from:'))
          if (!fromPid) continue
          const rawId = fromPid.slice('from:'.length)
          const participant = participantStore.participants.get(rawId)
          if (!participant) continue
          if (participant.isInternal || participant.isSpammer) continue

          participantId = rawId
          if (participant.entityInstanceId) contactInstanceId = participant.entityInstanceId
          break
        }

        if (!participantId) {
          toastError({
            title: 'Cannot create ticket',
            description: 'No external sender found on this thread.',
          })
          return null
        }

        // Force-create the contact if the participant isn't linked yet.
        if (!contactInstanceId) {
          try {
            const result = await ensureContactMutation.mutateAsync({ participantId })
            contactInstanceId = result.entityInstanceId
            participantStore.updateParticipant(participantId, {
              entityInstanceId: contactInstanceId,
            })
          } catch (error) {
            toastError({
              title: 'Cannot create ticket',
              description:
                error instanceof Error ? error.message : 'Failed to create contact for sender.',
            })
            return null
          }
        }

        try {
          const assignedToId = thread.assigneeId ? parseActorId(thread.assigneeId).id : undefined
          const subject = thread.subject?.trim() || 'Untitled'
          // Ticket title requires min 3 chars — pad short subjects so the backend doesn't reject.
          const title = subject.length >= 3 ? subject : subject.padEnd(3, ' ')

          const created = await createTicketMutation.mutateAsync({
            title,
            contactId: contactInstanceId,
            type: 'GENERAL',
            status: 'OPEN',
            ...(assignedToId ? { assignedToId } : {}),
          })

          const ticketInstanceId = created.id as string
          update(threadId, { ticketId: toRecordId('ticket', ticketInstanceId) })
          toastSuccess({ title: 'Ticket created and linked' })
          return ticketInstanceId
        } catch (error) {
          toastError({
            title: 'Failed to create ticket',
            description: error instanceof Error ? error.message : 'Unknown error',
          })
          return null
        }
      },

      openReplyBox: (mode: EditorMode | 'generic', message?: any) => {
        // Example threads belong to a seeded placeholder integration that can't
        // actually send — short-circuit and surface the inline banner instead.
        if (thread?.integrationIsExample) {
          toastError({
            title: 'This is example data',
            description: 'Connect a real inbox to send replies.',
          })
          return
        }
        if (mode === 'generic') {
          handleShowGenericReply()
        } else if (message) {
          // Map EditorMode to the expected type for openEditorForAction
          let mappedMode: 'reply' | 'replyAll' | 'forward' = 'reply'
          if (mode === 'reply') mappedMode = 'reply'
          else if (mode === 'replyAll') mappedMode = 'replyAll'
          else if (mode === 'forward') mappedMode = 'forward'
          openEditorForAction(mappedMode, message)
        }
      },

      closeReplyBox: () => {
        // Close and suppress a single automatic reopen from cached draft
        closeWithSuppress()
      },
    }),
    [
      thread,
      threadId,
      update,
      openEditorForAction,
      handleShowGenericReply,
      closeWithSuppress,
      createTicketMutation,
      ensureContactMutation,
    ]
  )

  // Create email actions
  const emailActions = useMemo(() => {
    if (!thread) return {} as any

    // Wrapper to map ReplyBoxMode to EditorMode
    const showReplyBox = (mode: 'reply' | 'reply-all' | 'forward', message: any) => {
      const mappedMode: EditorMode =
        mode === 'reply-all' ? 'replyAll' : (mode as 'reply' | 'forward')
      openEditorForAction(mappedMode, message)
    }

    // Enhanced email actions with actual implementations
    return {
      onReply: (message: any) => showReplyBox('reply', message),
      onReplyAll: (message: any) => showReplyBox('reply-all', message),
      onForward: (message: any) => showReplyBox('forward', message),

      onResend: async (message: any) => {
        try {
          // TODO: Implement resend API call
          toastError({
            title: 'Resend not yet implemented',
            description: 'This feature is coming soon',
          })
        } catch (error) {
          toastError({
            title: 'Failed to resend',
            description: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      },

      onDelete: async (message: any) => {
        // Move entire thread to trash using optimistic update
        update(thread.id, { status: 'TRASH' })
      },

      onDownload: async (message: any) => {
        try {
          // Download email as .eml file
          const response = await fetch(`/api/email/download/${message.id}`)
          if (!response.ok) throw new Error('Failed to download')

          const blob = await response.blob()
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `email-${message.id}.eml`
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          URL.revokeObjectURL(url)

          toastSuccess({ title: 'Email downloaded', description: '' })
        } catch (error) {
          toastError({
            title: 'Failed to download',
            description: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      },

      onPrint: (message: any) => {
        // Open print dialog for the email content
        const printWindow = window.open('', '_blank')
        if (printWindow) {
          printWindow.document.write(`
            <html>
              <head>
                <title>Email - ${message.subject || 'No Subject'}</title>
                <style>
                  body { font-family: Arial, sans-serif; margin: 20px; }
                  .header { margin-bottom: 20px; }
                  .meta { color: #666; font-size: 14px; }
                </style>
              </head>
              <body>
                <div class="header">
                  <h2>${message.subject || 'No Subject'}</h2>
                  <div class="meta">
                    <p>From: ${message.from?.name || message.from?.identifier || 'Unknown'}</p>
                    <p>Date: ${new Date(message.sentAt || message.createdAt).toLocaleString()}</p>
                  </div>
                </div>
                <div class="content">
                  ${message.textHtml || message.textPlain || ''}
                </div>
              </body>
            </html>
          `)
          printWindow.document.close()
          printWindow.print()
        }
      },

      onCopyId: async (message: any) => {
        try {
          await navigator.clipboard.writeText(message.id)
          toastSuccess({ title: 'Message ID copied', description: message.id })
        } catch (error) {
          toastError({ title: 'Failed to copy', description: 'Could not copy to clipboard' })
        }
      },

      onViewSource: (message: any) => {
        // Open modal or new window with raw email source
        const sourceWindow = window.open('', '_blank', 'width=800,height=600')
        if (sourceWindow) {
          sourceWindow.document.write(`
            <html>
              <head>
                <title>Email Source - ${message.id}</title>
                <style>
                  body { margin: 0; padding: 20px; background: #1e1e1e; }
                  pre {
                    color: #d4d4d4;
                    font-family: 'Consolas', 'Monaco', monospace;
                    font-size: 13px;
                    line-height: 1.5;
                    white-space: pre-wrap;
                    word-wrap: break-word;
                  }
                </style>
              </head>
              <body>
                <pre>${message.raw || message.textHtml || message.textPlain || 'Raw source not available'}</pre>
              </body>
            </html>
          `)
          sourceWindow.document.close()
        }
      },
    }
  }, [thread, update, openEditorForAction])

  // Create mutations object that matches the interface
  const mutations: ThreadMutations = useMemo(
    () => ({
      archiveThread: async () => {
        update(threadId, { status: 'ARCHIVED' })
      },
      unarchiveThread: async () => {
        update(threadId, { status: 'OPEN' })
      },
      moveToTrash: async () => {
        update(threadId, { status: 'TRASH' })
      },
      markAsSpam: async () => {
        update(threadId, { status: 'SPAM' })
      },
      updateAssignee: async (assigneeId: ActorId | null) => {
        update(threadId, { assigneeId })
      },
      updateSubject: async (subject: string) => {
        update(threadId, { subject })
      },
      moveToInbox: async (inboxId: string) => {
        update(threadId, { inboxId })
      },
      deletePermanently: async () => {
        remove(threadId)
      },
    }),
    [threadId, update, remove]
  )

  // Create context value - actions and UI state only, no thread data
  const contextValue: ThreadContextValue = {
    // Thread ID for reference
    threadId,

    // Reply Box State
    replyBox: {
      isOpen: isShowReplyBox,
      mode: editorMode,
      sourceMessage,
      ref: replyBoxRef,
      draft,
      isLoadingDraft,
    },

    // Mutations
    mutations,

    // Handlers
    handlers,

    // Email Actions
    emailActions,

    // Contact ID
    contactId,
  }

  return <ThreadContext.Provider value={contextValue}>{children}</ThreadContext.Provider>
}

/**
 * Hook to access thread context (actions and UI state).
 * For thread DATA, use useThread from '~/components/threads/hooks' instead.
 */
export function useThreadContext() {
  const context = useContext(ThreadContext)
  if (!context) {
    throw new Error('useThreadContext must be used within ThreadProvider')
  }
  return context
}

/** Returns mutations and handlers for thread actions */
export function useThreadActions() {
  const context = useThreadContext()
  return { mutations: context.mutations, handlers: context.handlers }
}

/** Returns reply box state and handlers */
export function useThreadReply() {
  const context = useThreadContext()
  return {
    ...context.replyBox,
    openReplyBox: context.handlers.openReplyBox,
    closeReplyBox: context.handlers.closeReplyBox,
  }
}

/** Returns email action handlers */
export function useThreadEmailActions() {
  const context = useThreadContext()
  return context.emailActions
}
