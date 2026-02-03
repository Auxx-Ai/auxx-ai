'use client'
// src/hooks/use-reply-box.tsx
import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import type { EditorMode, MessageType } from '~/components/mail/email-editor/types'
import { useDraft } from '~/components/mail/email-editor/hooks'
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
  const [sourceMessage, setSourceMessage] = useState<MessageType | null>(null)
  const replyBoxRef = useRef<HTMLDivElement>(null)
  const suppressAutoOpenOnce = useRef(false)

  // Extract first draft ID from draftIds (format: "draft:abc123")
  const firstDraftId = useMemo(() => {
    console.log('[useReplyBox] thread.draftIds:', thread?.draftIds)
    const draftRecordId = thread?.draftIds?.[0]
    if (!draftRecordId) return null
    // Extract ID after "draft:" prefix
    const parts = draftRecordId.split(':')
    const extractedId = parts.length > 1 ? parts[1] : null
    console.log('[useReplyBox] extractedId:', extractedId)
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

  // Effect to automatically open the editor if a draft exists when loaded
  useEffect(() => {
    if (effectiveDraft) {
      if (suppressAutoOpenOnce.current) {
        suppressAutoOpenOnce.current = false
      } else {
        console.log('Draft found, showing editor.', {
          threadId: thread?.id,
          draftId: effectiveDraft.id,
        })
        setIsShowReplyBox(true)
        setEditorMode('draft')
        setSourceMessage(null)
      }
    }
  }, [effectiveDraft, thread?.id])

  // Reset internal state ONLY when the thread ID actually changes
  const previousThreadId = useRef<string | null | undefined>(null)
  useEffect(() => {
    const currentThreadId = thread?.id
    const hasDraft = !!effectiveDraft

    if (currentThreadId !== previousThreadId.current) {
      console.log('Thread ID changed, resetting reply box state.', {
        oldId: previousThreadId.current,
        newId: currentThreadId,
      })
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
        console.log('useReplyBox: Draft found on thread update, showing editor.', {
          threadId: currentThreadId,
          draftId: effectiveDraft.id,
        })
        setIsShowReplyBox(true)
        setEditorMode('draft')
        setSourceMessage(null)
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
    (mode: 'reply' | 'replyAll' | 'forward', message: MessageType) => {
      // const message = findSentMessageById(messageId)
      if (!message || typeof message !== 'object') {
        console.log('Source message not found for action', { message, mode })
        return
      }
      console.log('Opening editor for action', { mode, messageId: message.id })

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
    (lastMessage?: MessageType) => {
      if (!lastMessage) {
        console.log('Cannot reply, no message provided.')
        return
      }
      openEditorForAction('reply', lastMessage)
    },
    [openEditorForAction]
  )

  return {
    isShowReplyBox,
    setIsShowReplyBox,
    editorMode,
    sourceMessage,
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
