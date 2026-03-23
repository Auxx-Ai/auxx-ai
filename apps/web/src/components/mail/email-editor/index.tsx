// apps/web/src/components/mail/email-editor/index.tsx
'use client'
import type { IdentifierType } from '@auxx/database/types'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Separator } from '@auxx/ui/components/separator'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Loader2,
  Mail,
  Minus,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useDropzone } from 'react-dropzone'
import { EditorToolbar } from '~/components/editor/editor-button'
import { EditorProvider, useEditorContext } from '~/components/editor/editor-context'
import { useFileSelect } from '~/components/file-select/hooks/use-file-select'
import { useCountUpdates } from '~/components/mail/hooks'
import { SignatureEditor } from '~/components/signatures/ui'
import { getMessageListStoreState } from '~/components/threads/store/message-list-store'
import { getThreadStoreState } from '~/components/threads/store/thread-store'
import { useAnalytics } from '~/hooks/use-analytics'
import { useConfirm } from '~/hooks/use-confirm'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
// Local imports
import { api } from '~/trpc/react'
import {
  AI_OPERATION,
  type AIOperation,
  COMPOSE_ENTITY_TYPE,
  OUTPUT_FORMAT,
} from '~/types/ai-tools'
import { AIStatus } from './ai-status'
import { deriveInitialState, type InitState } from './derive-initial'
import {
  EditorActiveStateProvider,
  useEditorActiveStateContext,
} from './editor-active-state-context'
import { useAIToolsState, useDraftMutations } from './hooks'
import IntegrationSelector from './integration-selector'
// Editor Imports
import { LazyTiptapEditor } from './lazy-tiptap-editor'
import { MessageFile } from './message-file'
import PrevMessage from './prev-message'
import { type RecipientField, RecipientInput, type RecipientInputHandle } from './recipient-input'
import type {
  FileAttachment,
  ParticipantInputData,
  RecipientState,
  Recipients,
  ReplyComposeEditorProps,
} from './types'
import { useDraftAutosave } from './use-draft-autosave'

const INTERACTIVE_ELEMENT_SELECTORS = `
  button, a, input, select, textarea,
  [role="button"], [role="option"], [role="combobox"], [role="menuitem"], [role="tab"],
  .ProseMirror, [data-radix-popper-content-wrapper], [data-radix-select-trigger],
  .tippy-box, .editor-toolbar-wrapper, .signature-picker-popover
`.trim()
/**
 * Check if editor content is effectively empty
 */
const isContentEmpty = (editor: any): boolean => {
  if (!editor) return true
  const plainText = editor.getText()?.trim() ?? ''
  if (plainText === '') {
    const html = editor.getHTML()
    const strippedHtml = html.replace(/<([a-z][a-z0-9]*)\s+[^>]*>/gi, '<$1>').replace(/\s+/g, '')
    return /^(<p>(<br>)*<\/p>)+$/.test(strippedHtml)
  }
  return false
}
/**
 * Convert recipients array to mutation payload format
 */
const toPayload = (recipients: RecipientState[]): ParticipantInputData[] =>
  recipients.map((r) => ({
    identifier: r.identifier,
    identifierType: r.identifierType,
    name: r.name || undefined,
  }))
function ReplyComposeEditorComponent({
  thread,
  sourceMessage,
  draft: initialDraft,
  mode,
  onClose,
  onSendSuccess,
  presetValues,
  isDialogMode = false,
  onPopOut,
  onMinimize,
  onDockBack,
  onSubjectChange,
}: ReplyComposeEditorProps) {
  // Z-index override for popovers when editor is in floating mode (above compose at z-101+)
  const popoverZIndex = isDialogMode ? 'z-[200]' : undefined

  const utils = api.useUtils()
  const { editor } = useEditorContext()
  const activeState = useEditorActiveStateContext()
  const [confirm, ConfirmDialog] = useConfirm()
  const posthog = useAnalytics()
  const { onSendDraft } = useCountUpdates()

  // Query integrations when needed
  const { data: integrations } = api.channel.list.useQuery(undefined, {
    enabled: mode === 'new',
  })
  // Initialize state with pure function + lazy evaluation
  const [state, setState] = useState<InitState>(() => {
    const derived = deriveInitialState({
      mode,
      thread,
      sourceMessage,
      draft: initialDraft,
      defaultIntegrationId: integrations?.channels?.[0]?.id,
      presetValues,
    })
    return derived
  })
  // Unified recipients state
  const [recipients, setRecipients] = useState<Recipients>(() => ({
    TO: state.to,
    CC: state.cc,
    BCC: state.bcc,
  }))
  // Recipient input refs for pre-send commit
  const toInputRef = useRef<RecipientInputHandle>(null)
  const ccInputRef = useRef<RecipientInputHandle>(null)
  const bccInputRef = useRef<RecipientInputHandle>(null)

  // Other UI state
  const [content, setContent] = useState(state.contentHtml)
  const [showCc, setShowCc] = useState(state.cc.length > 0)
  const [showBcc, setShowBcc] = useState(state.bcc.length > 0)
  const [showSubject, setShowSubject] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [isDraftSaved, setIsDraftSaved] = useState(!!initialDraft)

  // Attachments state - persisted attachments from draft
  const [attachments, setAttachments] = useState<FileAttachment[]>(
    () => initialDraft?.attachments ?? []
  )

  // Sync state when draft prop changes (e.g., navigating back to thread with existing draft)
  const initializedDraftIdRef = useRef<string | null>(initialDraft?.id ?? null)
  useEffect(() => {
    // Only sync if draft ID changed and we have a new draft
    if (initialDraft && initialDraft.id !== initializedDraftIdRef.current) {
      initializedDraftIdRef.current = initialDraft.id

      const newState = deriveInitialState({
        mode,
        thread,
        sourceMessage,
        draft: initialDraft,
        defaultIntegrationId: integrations?.channels?.[0]?.id,
        presetValues,
      })

      setState(newState)
      setContent(newState.contentHtml)
      setRecipients({
        TO: newState.to,
        CC: newState.cc,
        BCC: newState.bcc,
      })
      setShowCc(newState.cc.length > 0)
      setShowBcc(newState.bcc.length > 0)
      // Sync attachments from draft
      setAttachments(initialDraft.attachments ?? [])
      setIsDraftSaved(true) // Draft was loaded from server
    }
  }, [initialDraft, mode, thread, sourceMessage, integrations, presetValues])
  // Generate temp ID for file uploads before draft exists
  const tempEntityId = useMemo(
    () => state.draftId || `temp-message-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    [state.draftId]
  )
  // File selection hook - used ONLY for new uploads
  const fileSelect = useFileSelect({
    entityType: 'MESSAGE',
    entityId: tempEntityId,
    allowMultiple: true,
    maxFiles: 10,
    maxFileSize: 25 * 1024 * 1024, // 25MB
    autoStart: true,
    onChange: () => {
      setIsDraftSaved(false)
    },
    onUploadComplete: () => {
      // Mark draft as unsaved so autosave picks up the completed uploads
      setIsDraftSaved(false)
    },
  })

  // Handle preset attachments on initial mount (when no draft exists)
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    if (!initialDraft && presetValues?.attachments && presetValues.attachments.length > 0) {
      setAttachments(presetValues.attachments)
    }
  }, []) // Only run on mount

  // Remove attachment handler
  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
    setIsDraftSaved(false)
  }, [])
  // Dropzone configuration
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      fileSelect.addFiles(acceptedFiles)
    },
    noClick: true, // Don't trigger on click (editor handles clicks)
    noKeyboard: true,
  })
  // Handle draft ID update after save
  // Note: Entity ID is set during initial hook creation and remains static
  // Files uploaded before draft creation will be associated via tempEntityId

  // Track when user requested discard to handle late autosave completions
  const discardAfterSave = useRef(false)

  // Ref to store deleteDraft for use in onUpsertSuccess callback
  const deleteDraftRef = useRef<((draftId: string) => Promise<void>) | undefined>(undefined)

  // Draft mutations hook - centralizes upsert/delete with ThreadStore sync
  const { upsert, deleteDraft, isUpserting, isDeleting } = useDraftMutations({
    threadId: thread?.id ?? state.threadId,
    onUpsertSuccess: (data) => {
      // If user already clicked discard and we got a late save, delete the new draft
      if (discardAfterSave.current) {
        if (data?.id) {
          deleteDraftRef
            .current?.(data.id)
            .then(() => onClose())
            .finally(() => {
              discardAfterSave.current = false
            })
        } else {
          discardAfterSave.current = false
          onClose()
        }
        return
      }
      // Normal success - state is updated via autosave's onSaved callback
    },
    onUpsertError: (error) => {
      // If discard was requested, suppress save errors (draft likely deleted/not found)
      if (discardAfterSave.current) return
      // Error toast is handled by the hook
    },
    onDeleteMutate: (draftId) => {
      // Clear local draft state immediately (optimistic update)
      setState((prev) => ({ ...prev, draftId: null }))
    },
    onDeleteError: (error, draftId) => {
      // Rollback on error
      setState((prev) => ({ ...prev, draftId }))
      // Error toast is handled by the hook
    },
  })

  // Update ref after hook returns for use in onUpsertSuccess
  deleteDraftRef.current = deleteDraft

  const sendMessageMutation = api.thread.sendMessage.useMutation({
    onMutate: () => setIsSending(true),
    onSuccess: (sentMessage) => {
      toastSuccess({ description: 'Message sent successfully' })

      // Draft cleanup (if sending from a draft)
      if (state.draftId) {
        // Tombstone: mark draft as not-found so useReplyBox skips fetch
        getThreadStoreState().markDraftNotFound(state.draftId)

        // Remove draft:<id> from thread's draftIds
        const threadId = thread?.id ?? state.threadId
        if (threadId) {
          const currentThread = getThreadStoreState().getThread(threadId)
          if (currentThread) {
            const recordId = `draft:${state.draftId}`
            getThreadStoreState().updateThread(threadId, {
              draftIds: currentThread.draftIds.filter((id) => id !== recordId),
            })
          }
        }

        // Clear tRPC cache for this draft
        utils.draft.getById.setData({ draftId: state.draftId }, undefined)

        // Decrement draft count
        onSendDraft()
      }

      // Message list refresh — invalidate both Zustand and React Query caches
      if (sentMessage.threadId) {
        getMessageListStoreState().invalidate(sentMessage.threadId)
        utils.message.listByThread.invalidate({ threadId: sentMessage.threadId })
      }

      // Thread metadata patch
      if (sentMessage.threadId) {
        const currentThread = getThreadStoreState().getThread(sentMessage.threadId)
        if (currentThread) {
          getThreadStoreState().updateThread(sentMessage.threadId, {
            lastMessageAt: sentMessage.sentAt?.toISOString() ?? new Date().toISOString(),
          })
        }
      }

      onSendSuccess()
      onClose()
    },
    onError: (error) => {
      toastError({ title: 'Failed to send message', description: error.message })
    },
    onSettled: () => setIsSending(false),
  })

  // Debounced delete to prevent double-click issues
  const debouncedDelete = useDebouncedCallback(
    (draftId: string) => {
      deleteDraft(draftId)
        .then(() => {
          // Clear any pending saves
          draftAutosave.abort()
        })
        .finally(() => {
          // Reset the flag even if delete failed; UI already closed
          discardAfterSave.current = false
        })
    },
    300,
    { leading: true, trailing: false } // fire immediately; ignore rapid subsequent clicks
  )
  // Prepare payload for autosave - combines persisted attachments + files from fileSelect
  const draftPayload = useMemo(() => {
    // Get files from fileSelect that are ready to save:
    // 1. Existing filesystem files (source === 'filesystem') - id is already the server file ID
    // 2. Completed uploads (serverFileId exists) - use serverFileId
    const filesFromSelect: FileAttachment[] = fileSelect.selectedItems
      .filter((item) => item.source === 'filesystem' || item.serverFileId)
      .map((item) => ({
        id: item.source === 'filesystem' ? item.id : item.serverFileId!,
        name: item.name,
        size: Number(item.size ?? 0),
        mimeType: item.mimeType || 'application/octet-stream',
        type: 'file' as const,
      }))

    // Combine persisted attachments + files from select (avoiding duplicates)
    const existingIds = new Set(attachments.map((a) => a.id))
    const allAttachments = [
      ...attachments,
      ...filesFromSelect.filter((f) => !existingIds.has(f.id)),
    ]

    return {
      threadId: state.threadId,
      integrationId: state.integrationId,
      inReplyToMessageId: state.sourceMessageId,
      includePreviousMessage: state.includePrev,
      subject: state.subject,
      textHtml: content,
      signatureId: state.signatureId,
      to: toPayload(recipients.TO),
      cc: toPayload(recipients.CC),
      bcc: toPayload(recipients.BCC),
      attachments: allAttachments,
      draftId: state.draftId,
    }
  }, [state, content, recipients, attachments, fileSelect.selectedItems])
  // Auto-save hook
  const draftAutosave = useDraftAutosave({
    enabled: !isSending && !!state.integrationId,
    payload: draftPayload,
    isEmpty: () => isContentEmpty(editor),
    createOrUpdateDraft: upsert,
    onSaved: ({ draftId, threadId }) => {
      setState((prev) => {
        const nextThreadId = threadId ?? prev.threadId
        // Only update if something actually changed to prevent infinite loops
        if (prev.draftId === draftId && prev.threadId === nextThreadId) {
          return prev
        }
        // Track email_draft_created when a draft is first saved
        if (!prev.draftId && draftId) {
          posthog?.capture('email_draft_created')
        }
        return { ...prev, draftId, threadId: nextThreadId }
      })
      setIsDraftSaved(true)
    },
    onCacheSync: ({ threadId, draftData }) => {},
  })
  // Recipient management
  const upsertRecipient = useCallback((role: keyof Recipients, recipient: RecipientState) => {
    setRecipients((prev) => {
      const list = prev[role]
      if (list.some((r) => r.identifier === recipient.identifier)) return prev
      return { ...prev, [role]: [...list, recipient] }
    })
    setIsDraftSaved(false)
  }, [])
  const removeRecipient = useCallback((role: keyof Recipients, id: string) => {
    setRecipients((prev) => ({
      ...prev,
      [role]: prev[role].filter((r) => r.id !== id),
    }))
    setIsDraftSaved(false)
  }, [])
  // Handlers
  const handleContentChange = useCallback((newContent: string) => {
    setContent((prev) => (prev === newContent ? prev : newContent))
    setIsDraftSaved(false)
  }, [])
  const handleSubjectChange = useCallback(
    (subject: string) => {
      setState((prev) => ({ ...prev, subject }))
      setIsDraftSaved(false)
      onSubjectChange?.(subject)
    },
    [onSubjectChange]
  )
  const handleSignatureChange = useCallback((signatureId: string | null) => {
    setState((prev) => ({ ...prev, signatureId }))
    setIsDraftSaved(false)
  }, [])
  const handleIntegrationChange = useCallback((integrationId: string) => {
    setState((prev) => ({ ...prev, integrationId }))
    setIsDraftSaved(false)
  }, [])
  const handleContactSelect = useCallback(
    (
      role: 'TO' | 'CC' | 'BCC',
      contactData: {
        id: string
        identifier: string
        identifierType: IdentifierType
        name?: string | null
      }
    ) => {
      upsertRecipient(role, {
        id: contactData.id,
        identifier: contactData.identifier,
        identifierType: contactData.identifierType,
        name: contactData.name,
      })
    },
    [upsertRecipient]
  )
  const handleMoveTo = useCallback(
    (fromField: RecipientField, id: string, target: RecipientField) => {
      setRecipients((prev) => {
        const recipient = prev[fromField].find((r) => r.id === id)
        if (!recipient) return prev
        if (prev[target].some((r) => r.identifier === recipient.identifier)) {
          return { ...prev, [fromField]: prev[fromField].filter((r) => r.id !== id) }
        }
        return {
          ...prev,
          [fromField]: prev[fromField].filter((r) => r.id !== id),
          [target]: [...prev[target], recipient],
        }
      })
      if (target === 'CC') setShowCc(true)
      if (target === 'BCC') setShowBcc(true)
      setIsDraftSaved(false)
    },
    []
  )
  // Calculate if editor has content
  // biome-ignore lint/correctness/useExhaustiveDependencies: content triggers recalculation when editor content changes
  const hasContent = useMemo(() => {
    if (!editor) return false
    return !isContentEmpty(editor)
  }, [editor, content])
  // Check if thread has previous messages
  const hasPreviousMessages = useMemo(() => {
    if (!thread) return false
    return thread.messageCount > 0
  }, [thread])
  // AI Tools State Management
  const {
    state: aiToolsState,
    pushToHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    setProcessing,
    setCurrentOperation,
    setError,
    clearError,
  } = useAIToolsState(editor)

  // Track AI operation timing
  const aiStartTimeRef = useRef<number>(0)

  // Process AI operation mutation
  const processAI = api.aiFeature.compose.useMutation({
    onSuccess: (response) => {
      if (!editor) return
      // Apply new content based on format
      if (response.format === OUTPUT_FORMAT.EDITOR) {
        const tiptapContent = JSON.parse(response.content)
        editor.commands.setContent(tiptapContent)
      } else if (response.format === OUTPUT_FORMAT.HTML) {
        editor.commands.setContent(response.content)
      } else {
        // Plain text - wrap in paragraph
        editor.commands.setContent(`<p>${response.content}</p>`)
      }
      // Push the new state to history after applying it
      pushToHistory(editor.getHTML(), aiToolsState.currentOperation)
      setProcessing(false)
      setCurrentOperation(null)
      clearError()

      // Track AI compose completion
      posthog?.capture('ai_compose_completed', {
        ticket_id: thread?.id || state.threadId || undefined,
        duration_ms: aiStartTimeRef.current ? Date.now() - aiStartTimeRef.current : undefined,
      })
    },
    onError: (error) => {
      toastError({
        title: 'AI operation failed',
        description: error.message,
      })
      setError(error.message)
      setProcessing(false)
      setCurrentOperation(null)

      // Track AI compose failure
      posthog?.capture('ai_compose_failed', {
        ticket_id: thread?.id || state.threadId || undefined,
        error: error.message,
      })
    },
  })

  // Wrapped undo handler with analytics tracking
  const handleUndo = useCallback(() => {
    undo()
    posthog?.capture('ai_change_undone')
  }, [undo, posthog])

  // Handle AI operation
  const handleAIOperation = useCallback(
    async (
      operation: AIOperation,
      options?: {
        tone?: string
        language?: string
      }
    ) => {
      if (!editor || aiToolsState.isProcessing) return
      const currentContent = editor.getHTML()
      // Don't process if content is empty (except for compose)
      if (operation !== AI_OPERATION.COMPOSE && !currentContent.replace(/<[^>]*>/g, '').trim()) {
        toastError({
          title: 'No content',
          description: 'Please add some content before using AI tools',
        })
        return
      }

      // Track AI events
      const ticketId = thread?.id || state.threadId || undefined
      if (operation === AI_OPERATION.COMPOSE) {
        posthog?.capture('ai_compose_started', { ticket_id: ticketId })
      } else {
        posthog?.capture('ai_tool_used', {
          operation: operation.toLowerCase(),
          tone: options?.tone,
          language: options?.language,
        })
      }

      // Save current state to history before AI operation
      // This ensures we can undo back to the state before the operation
      pushToHistory(currentContent, `before-${operation}`)
      setProcessing(true)
      setCurrentOperation(operation)
      aiStartTimeRef.current = Date.now()
      await processAI.mutateAsync({
        operation,
        messageHtml: currentContent,
        entityType: COMPOSE_ENTITY_TYPE.THREAD,
        entityId: thread?.id || state.threadId || '',
        senderId: 'current-user', // Will be filled by backend
        output: OUTPUT_FORMAT.HTML,
        ...options,
      })
    },
    [
      editor,
      aiToolsState.isProcessing,
      thread?.id,
      state.threadId,
      processAI,
      setProcessing,
      setCurrentOperation,
      pushToHistory,
      posthog,
    ]
  )
  const handleSendClick = useCallback(async () => {
    if (isSending || !editor?.isEditable) return
    // 0. Commit any pending recipient input before validation
    flushSync(() => {
      toInputRef.current?.commitPendingInput()
      ccInputRef.current?.commitPendingInput()
      bccInputRef.current?.commitPendingInput()
    })
    // 1. Set sending state immediately to prevent new autosaves
    setIsSending(true)
    // 2. Cancel any pending debounced saves
    draftAutosave.abort()
    try {
      // 3. Wait for any in-flight save to complete
      if (isUpserting) {
        try {
          const result = await upsert(draftPayload)
          if (result?.id) {
            setState((prev) => ({
              ...prev,
              draftId: result.id,
              threadId: result.threadId || prev.threadId,
            }))
          }
        } catch (error) {
          // If save fails, continue without draft ID
          console.warn('Draft save failed during send, continuing without draft ID', error)
        }
      }
      // 4. Validation
      if (!state.integrationId) {
        toastError({
          title: 'Missing Integration',
          description: 'Please select an integration to send from.',
        })
        setIsSending(false)
        return
      }
      const allRecipients = [...recipients.TO, ...recipients.CC, ...recipients.BCC]
      if (allRecipients.length === 0) {
        toastError({
          title: 'Missing Recipient',
          description: 'Please add at least one recipient (To, Cc, or Bcc).',
        })
        setIsSending(false)
        return
      }
      if (!state.subject.trim()) {
        toastError({ title: 'Missing Subject', description: 'Please enter a subject.' })
        setIsSending(false)
        return
      }
      const plainContent = editor?.getText()?.trim() ?? ''
      if (!plainContent) {
        toastError({
          title: 'Empty Message',
          description: 'Please enter some content before sending.',
        })
        setIsSending(false)
        return
      }
      // 5. Send with draft ID if available
      sendMessageMutation.mutate({
        threadId: thread?.id,
        integrationId: state.integrationId,
        draftMessageId: state.draftId, // Will be null if no draft was created
        subject: state.subject,
        textHtml: content,
        signatureId: state.signatureId,
        to: toPayload(recipients.TO),
        cc: toPayload(recipients.CC),
        bcc: toPayload(recipients.BCC),
        attachments: draftPayload.attachments, // Use combined attachments from payload
        includePreviousMessage: state.includePrev,
        linkTicketId: presetValues?.linkTicketId,
      })
    } catch (error) {
      setIsSending(false) // Reset on error
      throw error
    }
  }, [
    isSending,
    editor,
    state,
    recipients,
    content,
    thread?.id,
    sendMessageMutation,
    draftPayload,
    draftAutosave,
    upsert,
    isUpserting,
  ])
  const handleDiscardClick = useCallback(async () => {
    if (isSending || isDeleting) return

    // Only confirm if there's a draft with content
    const hasContent = state.draftId || !isContentEmpty(editor)

    if (hasContent) {
      const confirmed = await confirm({
        title: 'Discard draft?',
        description: 'This draft will be permanently deleted.',
        confirmText: 'Discard',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
    }

    // Abort any pending autosaves immediately
    discardAfterSave.current = true
    draftAutosave.abort()
    if (state.draftId) {
      // Use debounced delete to prevent double-clicks
      debouncedDelete(state.draftId)
    }
    // Close immediately for instant UX feedback
    onClose()
  }, [
    state.draftId,
    isSending,
    isDeleting,
    onClose,
    draftAutosave,
    debouncedDelete,
    editor,
    confirm,
  ])

  /** Close without deleting draft (used in dialog mode) */
  const handleCloseClick = useCallback(() => {
    onClose()
  }, [onClose])
  const handleWrapperClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!editor || editor.isDestroyed || editor.isFocused || isSending) return
      const target = event.target as Element
      if (target.closest(INTERACTIVE_ELEMENT_SELECTORS)) return
      editor.commands.focus('end')
    },
    [editor, isSending]
  )
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Meta+Enter to send message
      if (event.metaKey && event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        // Only send if not already sending and not processing AI
        if (!isSending && !aiToolsState.isProcessing && editor?.isEditable) {
          handleSendClick()
        }
      }
    },
    [isSending, aiToolsState.isProcessing, editor, handleSendClick]
  )
  // Find message for previous message component
  const messageForPrevComponent = useMemo(() => {
    if (sourceMessage) return sourceMessage
    if (state.sourceMessageId && thread?.messages) {
      return thread.messages.find((m) => m.id === state.sourceMessageId) || null
    }
    return null
  }, [sourceMessage, state.sourceMessageId, thread])

  return (
    <>
      <ConfirmDialog />
      <div className='transition-background flex flex-col duration-200 ease-in-out relative'>
        {/* Header */}
        <div className='absolute top-[-32px] h-full w-full rounded-t-[15px] bg-gray-300  dark:bg-gray-800 '>
          <div className='flex justify-between h-[36px]'>
            <div className='ps-4 flex flex-row items-center gap-2'>
              <Mail size='16' className='my-1.5 text-foreground' />
              <span className='text-sm'>Compose Email</span>
              {isUpserting && (
                <Loader2 className='ml-auto size-4 animate-spin text-muted-foreground' />
              )}
            </div>
            <div className='flex flex-row gap-0 items-center me-1'>
              {/* AI Status (undo/redo and processing) */}
              <AIStatus
                state={aiToolsState}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={handleUndo}
                onRedo={redo}
              />
              {state.draftId && <span className='text-muted-foreground text-sm me-2'>Draft</span>}

              {/* Pop-out button — only in inline (non-dialog) mode */}
              {!isDialogMode && onPopOut && (
                <Button
                  size='icon-sm'
                  variant='ghost'
                  className='rounded-full text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700'
                  onClick={onPopOut}
                  title='Pop out'>
                  <ArrowUpRight />
                </Button>
              )}

              {/* Dock-back button — floating mode when thread is visible */}
              {isDialogMode && onDockBack && (
                <Button
                  size='icon-sm'
                  variant='ghost'
                  className='rounded-full text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700'
                  onClick={onDockBack}
                  title='Dock into thread'>
                  <ArrowDownLeft />
                </Button>
              )}

              {/* Minimize button — only in floating/dialog mode */}
              {isDialogMode && onMinimize && (
                <Button
                  size='icon-sm'
                  variant='ghost'
                  className='rounded-full text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700'
                  onClick={onMinimize}
                  title='Minimize'>
                  <Minus />
                </Button>
              )}

              {/* Delete button - only show in dialog mode when draft exists */}
              {isDialogMode && state.draftId && (
                <Button
                  size='icon-sm'
                  variant='ghost'
                  className='rounded-full text-muted-foreground hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30'
                  onClick={handleDiscardClick}
                  disabled={isSending || isUpserting || isDeleting}
                  title='Delete draft'>
                  {isDeleting ? <Loader2 className='size-4 animate-spin' /> : <Trash2 />}
                </Button>
              )}

              {/* Close/Discard button */}
              <Button
                size='icon-sm'
                variant='ghost'
                className='rounded-full text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700'
                onClick={isDialogMode ? handleCloseClick : handleDiscardClick}
                disabled={isSending || isUpserting || (isDeleting && !isDialogMode)}>
                {isDeleting && !isDialogMode ? <Loader2 className='size-4 animate-spin' /> : <X />}
              </Button>
            </div>
          </div>
        </div>

        {/* Main Editor Body with Dropzone */}
        <div
          {...getRootProps()}
          className={cn(
            'relative flex flex-col rounded-[20px] border border-transparent hover:border-gray-400 dark:hover:border-black/20 hover:bg-gray-50 dark:hover:bg-background ring-2 ring-transparent bg-white shadow-lg dark:bg-background',
            'focus-within:ring-blue-500 focus-within:hover:bg-white focus-within:hover:border-transparent',
            activeState.isActive && 'ring-blue-500 hover:bg-white hover:border-transparent',
            isDragActive && 'border-transparent bg-white hover:bg-white hover:border-transparent '
          )}
          onClick={handleWrapperClick}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            // Check if focus is within editor content areas
            if (!e.currentTarget.contains(e.relatedTarget)) {
              activeState.setHasFocus(true)
            }
          }}
          onBlur={(e) => {
            // Only blur if focus moves outside editor AND no UI elements are open
            if (!e.currentTarget.contains(e.relatedTarget)) {
              // Small delay to allow popovers/selects to register as open
              setTimeout(() => {
                activeState.setHasFocus(false)
              }, 0)
            }
          }}>
          <input {...getInputProps()} />

          {/* Drag overlay */}
          {isDragActive && (
            <div className='absolute inset-[-1px] z-50 flex items-center justify-center rounded-[20px] bg-blue-500/10 border-1 border-dashed border-info'>
              <div className='text-center'>
                <Upload className='mx-auto size-8 text-blue-500' />
                <Badge variant='blue' className='cursor-default'>
                  Drop here
                </Badge>
              </div>
            </div>
          )}
          {/* Header Fields */}
          <div className='flex flex-col border-b border-border'>
            {/* From Field */}
            <div className='flex items-center gap-2 px-4 py-2'>
              <span className='w-10 shrink-0 text-sm text-muted-foreground'>From:</span>
              <div className='flex-1'>
                <IntegrationSelector
                  value={state.integrationId}
                  onChange={handleIntegrationChange}
                  disabled={isSending}
                  className={popoverZIndex}
                />
              </div>
            </div>
            <Separator className='mx-4 w-auto' />

            {/* To Field & Toggles */}
            <div className='flex items-center gap-2 px-4 py-2'>
              <span className='w-10 shrink-0 text-sm text-muted-foreground'>To:</span>
              <RecipientInput
                ref={toInputRef}
                field='TO'
                recipients={recipients.TO}
                onAdd={(r) => upsertRecipient('TO', r)}
                onRemove={(id) => removeRecipient('TO', id)}
                onMoveTo={(id, target) => handleMoveTo('TO', id, target)}
                onContactSelect={(c) => handleContactSelect('TO', c)}
                placeholder='Add recipients...'
                disabled={isSending}
                popoverClassName={popoverZIndex}
              />
              <div className='ml-auto flex shrink-0 items-center gap-1'>
                {!showSubject && (
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 px-1 text-xs text-info'
                    onClick={() => setShowSubject(true)}
                    disabled={isSending}>
                    Subject
                  </Button>
                )}
                {!showCc && (
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 px-1 text-xs text-info'
                    onClick={() => setShowCc(true)}
                    disabled={isSending}>
                    Cc
                  </Button>
                )}
                {!showBcc && (
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 px-1 text-xs text-info'
                    onClick={() => setShowBcc(true)}
                    disabled={isSending}>
                    Bcc
                  </Button>
                )}
              </div>
            </div>

            {/* Cc Field */}
            {showCc && (
              <>
                <Separator className='mx-4 w-auto' />
                <div className='flex items-center gap-2 px-4 py-2'>
                  <span className='w-10 shrink-0 text-sm text-muted-foreground'>Cc:</span>
                  <RecipientInput
                    ref={ccInputRef}
                    field='CC'
                    recipients={recipients.CC}
                    onAdd={(r) => upsertRecipient('CC', r)}
                    onRemove={(id) => removeRecipient('CC', id)}
                    onMoveTo={(id, target) => handleMoveTo('CC', id, target)}
                    onContactSelect={(c) => handleContactSelect('CC', c)}
                    placeholder='Add Cc recipients...'
                    disabled={isSending}
                    popoverClassName={popoverZIndex}
                  />
                  <Button
                    variant='ghost'
                    size='sm'
                    className='ml-auto h-6 px-1 text-xs text-muted-foreground'
                    onClick={() => {
                      setShowCc(false)
                      setRecipients((prev) => ({ ...prev, CC: [] }))
                    }}
                    disabled={isSending}>
                    Remove
                  </Button>
                </div>
              </>
            )}

            {/* Bcc Field */}
            {showBcc && (
              <>
                <Separator className='mx-4 w-auto' />
                <div className='flex items-center gap-2 px-4 py-2'>
                  <span className='w-10 shrink-0 text-sm text-muted-foreground'>Bcc:</span>
                  <RecipientInput
                    ref={bccInputRef}
                    field='BCC'
                    recipients={recipients.BCC}
                    onAdd={(r) => upsertRecipient('BCC', r)}
                    onRemove={(id) => removeRecipient('BCC', id)}
                    onMoveTo={(id, target) => handleMoveTo('BCC', id, target)}
                    onContactSelect={(c) => handleContactSelect('BCC', c)}
                    placeholder='Add Bcc recipients...'
                    disabled={isSending}
                    popoverClassName={popoverZIndex}
                  />
                  <Button
                    variant='ghost'
                    size='sm'
                    className='ml-auto h-6 px-1 text-xs text-muted-foreground'
                    onClick={() => {
                      setShowBcc(false)
                      setRecipients((prev) => ({ ...prev, BCC: [] }))
                    }}
                    disabled={isSending}>
                    Remove
                  </Button>
                </div>
              </>
            )}

            {/* Subject Field */}
            {showSubject && (
              <>
                <Separator className='mx-4 w-auto' />
                <div className='flex items-center gap-2 px-4 py-2'>
                  <span className='shrink-0 text-sm text-muted-foreground'>Subject:</span>
                  <input
                    type='text'
                    className='w-full flex-1 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground/50'
                    value={state.subject}
                    onChange={(e) => handleSubjectChange(e.target.value)}
                    placeholder='Enter subject'
                    disabled={isSending}
                  />
                  <Button
                    variant='ghost'
                    size='sm'
                    className='ml-auto h-6 px-1 text-xs text-muted-foreground'
                    onClick={() => setShowSubject(false)}
                    disabled={isSending}>
                    Remove
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Editor Section */}
          <div className='flex flex-col flex-1 min-h-[150px]'>
            <LazyTiptapEditor
              content={content}
              onChange={handleContentChange}
              placeholder='Type / to insert a snippet.'
              editable={!aiToolsState.isProcessing}
            />
            <SignatureEditor
              integrationId={state.integrationId}
              selectedSignatureId={state.signatureId}
              onSignatureChange={handleSignatureChange}
              disabled={isSending}
              className={popoverZIndex}
            />

            {/* File Attachments Display - Persisted + In-Progress Uploads */}
            {(attachments.length > 0 || fileSelect.selectedItems.length > 0) && (
              <div className='mx-4 mb-3 mt-2'>
                <div className='text-xs text-muted-foreground mb-2'>
                  Attachments ({attachments.length + fileSelect.selectedItems.length})
                </div>
                <div className='flex flex-wrap gap-2'>
                  {/* Persisted attachments */}
                  {attachments.map((attachment) => (
                    <MessageFile
                      key={attachment.id}
                      file={{
                        id: attachment.id,
                        name: attachment.name,
                        mimeType: attachment.mimeType,
                        size: BigInt(attachment.size || 0),
                        source: 'existing' as const,
                      }}
                      showRemoveButton={true}
                      onRemove={() => removeAttachment(attachment.id)}
                      className='group'
                    />
                  ))}
                  {/* In-progress uploads */}
                  {fileSelect.selectedItems.map((file) => (
                    <MessageFile
                      key={file.id}
                      file={{
                        id: file.id,
                        name: file.name,
                        mimeType: file.mimeType ?? undefined,
                        size: file.size ?? undefined,
                        source: 'upload' as const,
                      }}
                      showRemoveButton={true}
                      onRemove={() => fileSelect.removeItem(file.id)}
                      className='group'
                    />
                  ))}
                </div>
              </div>
            )}

            {state.includePrev && messageForPrevComponent && (
              <PrevMessage
                message={messageForPrevComponent}
                onRemove={() => setState((prev) => ({ ...prev, includePrev: false }))}
              />
            )}
            {!state.includePrev && messageForPrevComponent && (
              <div className='px-2'>
                <Button
                  variant='ghost'
                  size='xs'
                  onClick={() => setState((prev) => ({ ...prev, includePrev: true }))}
                  title='Add previous message'
                  className='text-muted-foreground/50'
                  disabled={isSending}>
                  <Plus />
                  Add previous message
                </Button>
              </div>
            )}
          </div>

          {/* Toolbar with integrated AI Tools */}
          <div className='editor-toolbar-wrapper px-2 py-1 '>
            <div className='flex items-center gap-1 overflow-x-auto no-scrollbar md:gap-2'>
              <EditorToolbar
                editor={editor}
                onSend={handleSendClick}
                isSending={isSending}
                disabled={isSending || !editor?.isEditable || aiToolsState.isProcessing}
                fileSelect={fileSelect}
                popoverClassName={popoverZIndex}
                aiToolsProps={{
                  threadId: thread?.id || state.threadId || undefined,
                  hasContent,
                  hasPreviousMessages,
                  state: aiToolsState,
                  onOperation: handleAIOperation,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
// Editor Provider Wrapper with Active State Management
const ReplyComposeEditor = (props: ReplyComposeEditorProps) => (
  <EditorActiveStateProvider>
    <EditorProvider>
      <ReplyComposeEditorComponent {...props} />
    </EditorProvider>
  </EditorActiveStateProvider>
)
export default ReplyComposeEditor
