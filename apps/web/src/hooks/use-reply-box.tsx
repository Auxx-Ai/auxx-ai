'use client'
// src/hooks/use-reply-box.tsx
import { useState, useRef, useCallback, useEffect } from 'react'
import { type RouterOutputs } from '~/trpc/react'
import type { EditorMode } from '~/components/mail/email-editor' // Import the editor mode type

type ThreadWithDetails = RouterOutputs['thread']['getById']
type MessageType = ThreadWithDetails['messages'][number] // Type for sent messages
type DraftMessageType = Exclude<ThreadWithDetails['draftMessage'], null> // Type for draft message

/**
 * Custom hook for managing the state of the Reply/Compose editor.
 * @param thread - The detailed thread data, including potential draft message.
 * @returns Reply box state and handlers.
 */
export function useReplyBox(thread: ThreadWithDetails | null | undefined) {
  const [isShowReplyBox, setIsShowReplyBox] = useState(false)
  // Use the EditorMode type from the editor component
  const [editorMode, setEditorMode] = useState<EditorMode>('reply')
  // Store the source message (the one being replied/forwarded to)
  const [sourceMessage, setSourceMessage] = useState<MessageType | DraftMessageType | null>(null)
  const replyBoxRef = useRef<HTMLDivElement>(null)
  const suppressAutoOpenOnce = useRef(false)

  // Effect to automatically open the editor if a draft exists when the thread loads/changes
  useEffect(() => {
    if (thread?.draftMessage) {
      if (suppressAutoOpenOnce.current) {
        // Skip auto-open once, typically after an explicit close
        suppressAutoOpenOnce.current = false
      } else {
        console.log('Draft message found, showing editor.', {
        threadId: thread.id,
        draftId: thread.draftMessage.id,
        })
        setIsShowReplyBox(true)
        setEditorMode('draft') // Set mode to 'draft' to indicate loading existing draft
        setSourceMessage(null) // No specific source message when editing a draft
      }
    }
    // Reset source message when thread context changes fundamentally (e.g., different thread loaded)
    // This dependency array means it runs when the thread object reference changes.
  }, [thread]) // Depend only on the thread object reference

  // Reset internal state ONLY when the thread ID actually changes
  // This prevents closing the box just because the thread data refreshed after sending
  const previousThreadId = useRef<string | null | undefined>(null)
  useEffect(() => {
    const currentThreadId = thread?.id
    const hasDraft = !!thread?.draftMessage

    if (currentThreadId !== previousThreadId.current) {
      console.log('Thread ID changed, resetting reply box state.', {
        oldId: previousThreadId.current,
        newId: currentThreadId,
      })
      // Reset source message when thread changes, unless loading a draft initially
      if (!hasDraft) {
        setIsShowReplyBox(false)
        setSourceMessage(null) // Reset source on thread change
        setEditorMode('reply')
      }
      previousThreadId.current = currentThreadId
    }

    // Handle initial draft loading separately
    if (hasDraft && !isShowReplyBox && previousThreadId.current === currentThreadId) {
      // Only set if not already shown
      if (suppressAutoOpenOnce.current) {
        // Skip one automatic open after an explicit close
        suppressAutoOpenOnce.current = false
      } else {
        console.log(
          'useReplyBox: Draft message found on thread update (not ID change), showing editor.',
          { threadId: currentThreadId, draftId: thread.draftMessage!.id }
        )
        setIsShowReplyBox(true)
        setEditorMode('draft')
        setSourceMessage(null) // Clear source message when loading a draft
      }
    }
  }, [thread?.id, thread?.draftMessage, isShowReplyBox]) // Simplified dependency

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
   * Handles the generic "Reply" button click (usually replies to the last message).
   */
  const handleShowGenericReply = useCallback(() => {
    if (!thread?.messages || thread.messages.length === 0) {
      console.log('Cannot reply, thread has no messages.')
      return
    }
    // Reply to the last *sent* message in the thread
    const lastMessage = thread.messages[thread.messages.length - 1]
    if (lastMessage) {
      openEditorForAction('reply', lastMessage)
    }
  }, [thread?.messages, openEditorForAction])

  return {
    isShowReplyBox,
    setIsShowReplyBox, // Expose setter for manual closing
    editorMode, // The current mode ('reply', 'draft', etc.)
    sourceMessage, // The message being replied/forwarded to (null for draft/new)
    replyBoxRef, // Ref for scrolling
    openEditorForAction, // Function to open for reply/replyAll/forward
    handleShowGenericReply, // Function for the generic reply button
    // Helper to close and suppress one auto-open
    closeWithSuppress: () => {
      suppressAutoOpenOnce.current = true
      setIsShowReplyBox(false)
    },
  }
}
