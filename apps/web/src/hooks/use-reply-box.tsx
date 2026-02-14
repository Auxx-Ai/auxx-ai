'use client'
import { groupParticipantsByRole, type ParticipantId } from '@auxx/types'
// src/hooks/use-reply-box.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDraft } from '~/components/mail/email-editor/hooks'
import type {
  MessageType as EditorMessageType,
  EditorMode,
} from '~/components/mail/email-editor/types'
import { useMessage, useParticipant } from '~/components/threads/hooks'
import type { ThreadMeta } from '~/components/threads/store'
import { useThreadStore } from '~/components/threads/store/thread-store'

/**
 * Custom hook for managing the state of the Reply/Compose editor.
 * Fetches draft content if thread has draftIds.
 * @param thread - The thread metadata, including draftIds.
 * @returns Reply box state, handlers, and draft data.
 */
export function useReplyBox(thread: ThreadMeta | null | undefined) {
  const [isShowReplyBox, setIsShowReplyBox] = useState(false)
  const [editorMode, setEditorMode] = useState<EditorMode>('reply')
  const [sourceMessage, setSourceMessage] = useState<EditorMessageType | null>(null)
  const replyBoxRef = useRef<HTMLDivElement>(null)
  const suppressAutoOpenOnce = useRef(false)

  // Extract first draft ID from draftIds (format: "draft:abc123")
  const firstDraftId = useMemo(() => {
    const draftRecordId = thread?.draftIds?.[0]
    if (!draftRecordId) return null
    // Extract ID after "draft:" prefix
    const parts = draftRecordId.split(':')
    const extractedId = parts.length > 1 ? parts[1] : null
    return extractedId
  }, [thread?.draftIds])

  // Check if draft is already known to be not found (deleted)
  const isNotFound = useThreadStore((s) =>
    firstDraftId ? s.notFoundDraftIds.has(firstDraftId) : false
  )

  // Fetch draft content using useDraft hook
  // Skip fetching if draft is known to be deleted
  const { draft, isLoading: isLoadingDraft } = useDraft({
    draftId: firstDraftId,
    enabled: !!firstDraftId && !isNotFound,
  })

  // Use effective draft - treat not-found drafts as no draft
  const effectiveDraft = isNotFound ? undefined : draft

  // Fetch source message from inReplyToMessageId for drafts
  const inReplyToMessageId = effectiveDraft?.inReplyToMessageId ?? null
  const { message: sourceMessageMeta } = useMessage({
    messageId: inReplyToMessageId,
    enabled: !!inReplyToMessageId,
  })

  // Extract from participant ID from the message's participants
  const fromParticipantId = useMemo(() => {
    if (!sourceMessageMeta?.participants) return null
    const grouped = groupParticipantsByRole(sourceMessageMeta.participants as ParticipantId[])
    return grouped.from
  }, [sourceMessageMeta?.participants])

  // Fetch the from participant details
  const { participant: fromParticipant } = useParticipant({
    participantId: fromParticipantId,
    enabled: !!fromParticipantId,
  })

  // Build a compatible sourceMessage object from the fetched data
  const sourceMessageFromDraft: EditorMessageType | null = useMemo(() => {
    if (!sourceMessageMeta) return null
    return {
      id: sourceMessageMeta.id,
      threadId: sourceMessageMeta.threadId,
      subject: sourceMessageMeta.subject,
      snippet: sourceMessageMeta.snippet,
      textHtml: sourceMessageMeta.textHtml,
      textPlain: sourceMessageMeta.textPlain,
      isInbound: sourceMessageMeta.isInbound,
      sentAt: sourceMessageMeta.sentAt ? new Date(sourceMessageMeta.sentAt) : null,
      createdAt: new Date(sourceMessageMeta.createdAt),
      // Cast messageType - store may have additional types (WHATSAPP, CALL) not in editor type
      messageType: sourceMessageMeta.messageType as EditorMessageType['messageType'],
      from: fromParticipant
        ? {
            id: fromParticipant.id,
            identifier: fromParticipant.identifier,
            name: fromParticipant.name,
            displayName: fromParticipant.displayName,
          }
        : null,
    }
  }, [sourceMessageMeta, fromParticipant])

  // Effect to automatically open the editor if a draft exists when loaded
  useEffect(() => {
    if (effectiveDraft) {
      if (suppressAutoOpenOnce.current) {
        suppressAutoOpenOnce.current = false
      } else {
        setIsShowReplyBox(true)
        setEditorMode('draft')
        // Don't override sourceMessage here - let it be populated from sourceMessageFromDraft
      }
    }
  }, [effectiveDraft, thread?.id])

  // Reset internal state ONLY when the thread ID actually changes
  const previousThreadId = useRef<string | null | undefined>(null)
  useEffect(() => {
    const currentThreadId = thread?.id
    const hasDraft = !!effectiveDraft

    if (currentThreadId !== previousThreadId.current) {
      if (!hasDraft) {
        setIsShowReplyBox(false)
        setSourceMessage(null)
        setEditorMode('reply')
      }
      previousThreadId.current = currentThreadId
    }

    // Handle draft loading after thread ID is set
    if (hasDraft && !isShowReplyBox && previousThreadId.current === currentThreadId) {
      if (suppressAutoOpenOnce.current) {
        suppressAutoOpenOnce.current = false
      } else {
        setIsShowReplyBox(true)
        setEditorMode('draft')
        // Don't override sourceMessage - let it be populated from sourceMessageFromDraft
      }
    }
  }, [thread?.id, effectiveDraft, isShowReplyBox])

  /** Scrolls the reply box into view */
  const scrollIntoView = useCallback(() => {
    setTimeout(() => {
      // Timeout allows DOM to update before scrolling
      replyBoxRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest', // Use 'nearest' or 'center'
      })
    }, 50) // Small delay
  }, [])

  /**
   * Opens the editor for a specific action (reply, replyAll, forward).
   * @param mode - The desired editor mode.
   * @param messageId - The ID of the message to reply/forward to.
   */
  const openEditorForAction = useCallback(
    (mode: 'reply' | 'replyAll' | 'forward', message: EditorMessageType) => {
      // const message = findSentMessageById(messageId)
      if (!message || typeof message !== 'object') {
        return
      }

      setEditorMode(mode)
      setSourceMessage(message) // Set the message being acted upon
      setIsShowReplyBox(true)
      scrollIntoView()
    },
    [scrollIntoView]
  )

  /**
   * Opens the generic reply editor.
   * Requires a message to be passed since ThreadMeta doesn't contain messages.
   */
  const handleShowGenericReply = useCallback(
    (lastMessage?: EditorMessageType) => {
      if (!lastMessage) {
        return
      }
      openEditorForAction('reply', lastMessage)
    },
    [openEditorForAction]
  )

  // Return sourceMessage from state, or from draft's inReplyToMessageId if available
  const effectiveSourceMessage = sourceMessage ?? sourceMessageFromDraft

  return {
    isShowReplyBox,
    setIsShowReplyBox,
    editorMode,
    sourceMessage: effectiveSourceMessage,
    replyBoxRef,
    openEditorForAction,
    handleShowGenericReply,
    draft: effectiveDraft,
    isLoadingDraft,
    closeWithSuppress: () => {
      suppressAutoOpenOnce.current = true
      setIsShowReplyBox(false)
    },
  }
}
