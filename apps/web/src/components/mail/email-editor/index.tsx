// apps/web/src/components/mail/email-editor/index.tsx
'use client'
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Button } from '@auxx/ui/components/button'
import { Separator } from '@auxx/ui/components/separator'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Mail, Loader2, X, Ellipsis, Plus, Upload } from 'lucide-react'
import { Badge } from '@auxx/ui/components/badge'
import { useDropzone } from 'react-dropzone'
import { cn } from '@auxx/ui/lib/utils'
// Editor Imports
import TiptapEditor from '~/components/editor/tiptap-editor'
import { EditorToolbar } from '~/components/editor/editor-button'
import { EditorProvider, useEditorContext } from '~/components/editor/editor-context'
import {
  EditorActiveStateProvider,
  useEditorActiveStateContext,
} from './editor-active-state-context'
import SignatureEditor from './signature-editor'
import PrevMessage from './prev-message'
import { RecipientInput } from './recipient-input'
import IntegrationSelector from './integration-selector'
import { MessageFile } from './message-file'
import { useFileSelect } from '~/components/file-select/hooks/use-file-select'
import { useAIToolsState, useDraftMutations } from './hooks'
import { AIStatus } from './ai-status'
import {
  AI_OPERATION,
  OUTPUT_FORMAT,
  COMPOSE_ENTITY_TYPE,
  type AIOperation,
} from '~/types/ai-tools'
// Local imports
import { api } from '~/trpc/react'
import { useConfirm } from '~/hooks/use-confirm'
import { deriveInitialState, type InitState } from './derive-initial'
import { useDraftAutosave } from './use-draft-autosave'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import type {
  ReplyComposeEditorProps,
  Recipients,
  RecipientState,
  ParticipantInputData,
  DraftPayload,
} from './types'
import { type IdentifierType } from '@auxx/database/types'
// FileAttachment type for structured attachments
type FileAttachment = {
  id: string
  name: string
  size?: number
  mimeType?: string
  type: 'file' | 'asset' // 'file' = FolderFile, 'asset' = MediaAsset
}
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
/**
 * Transform file select items to FileAttachment format for API
 */
const transformToFileAttachments = (selectedItems: any[]): FileAttachment[] => {
  return selectedItems.map((item) => {
    // For existing attachments, use the original attachment data
    if ((item as any).isExistingAttachment) {
      return {
        id: (item as any).originalAttachmentId, // Use original attachment ID
        name: item.name,
        size: item.displaySize,
        mimeType: item.mimeType || undefined,
        type: (item as any).attachmentType || 'file', // Use stored original type
      }
    }
    // For new uploads, use the uploaded file data
    return {
      id: item.serverFileId || item.id,
      name: item.name,
      size: item.displaySize,
      mimeType: item.mimeType || undefined,
      type: item.source === 'filesystem' ? 'file' : 'asset',
    }
  })
}
/**
 * Transform draft attachments to FileSelectItem format for file picker
 */
const transformDraftAttachmentsToFileSelectItems = (attachments: any[]) => {
  return attachments.map((attachment) => ({
    id: `existing-${attachment.id}`, // Prefix to distinguish from new uploads
    name: attachment.name,
    type: 'file' as const,
    size: attachment.size ? BigInt(attachment.size) : null,
    displaySize: Number(attachment.size || 0),
    mimeType: attachment.mimeType || null,
    ext: attachment.name.includes('.') ? `.${attachment.name.split('.').pop()}` : null,
    createdAt: attachment.createdAt ? new Date(attachment.createdAt) : new Date(),
    updatedAt: attachment.createdAt ? new Date(attachment.createdAt) : new Date(),
    path: '/',
    parentId: null,
    source: (attachment.type === 'file' ? 'filesystem' : 'upload') as 'filesystem' | 'upload',
    serverFileId: attachment.mediaAssetId || attachment.id,
    // Mark as existing attachment for transformation back
    isExistingAttachment: true,
    originalAttachmentId: attachment.mediaAssetId || attachment.id,
    attachmentType: attachment.type,
  }))
}
function ReplyComposeEditorComponent({
  thread,
  sourceMessage,
  draft: initialDraft,
  mode,
  onClose,
  onSendSuccess,
  presetValues,
}: ReplyComposeEditorProps) {
  const utils = api.useUtils()
  const { editor } = useEditorContext()
  const activeState = useEditorActiveStateContext()
  const [confirm, ConfirmDialog] = useConfirm()
  // Query integrations when needed
  const { data: integrations } = api.integration.getIntegrations.useQuery(undefined, {
    enabled: mode === 'new',
  })
  // Initialize state with pure function + lazy evaluation
  const [state, setState] = useState<InitState>(() => {
    const derived = deriveInitialState({
      mode,
      thread,
      sourceMessage,
      draft: initialDraft,
      defaultIntegrationId: integrations?.integrations?.[0]?.id,
      presetValues,
    })
    console.log('[EmailEditor] useState init:', {
      draftId: initialDraft?.id,
      draftTextHtmlLength: initialDraft?.textHtml?.length,
      derivedContentHtmlLength: derived.contentHtml?.length,
      derivedDraftId: derived.draftId,
    })
    return derived
  })
  // Unified recipients state
  const [recipients, setRecipients] = useState<Recipients>(() => ({
    TO: state.to,
    CC: state.cc,
    BCC: state.bcc,
  }))
  // Other UI state
  const [content, setContent] = useState(state.contentHtml)
  const [showCc, setShowCc] = useState(state.cc.length > 0)
  const [showBcc, setShowBcc] = useState(state.bcc.length > 0)
  const [showSubject, setShowSubject] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [isDraftSaved, setIsDraftSaved] = useState(false)

  // Sync state when draft prop changes (e.g., navigating back to thread with existing draft)
  const initializedDraftIdRef = useRef<string | null>(initialDraft?.id ?? null)
  useEffect(() => {
    // Only sync if draft ID changed and we have a new draft
    if (initialDraft && initialDraft.id !== initializedDraftIdRef.current) {
      console.log('[EmailEditor] syncing draft content:', initialDraft.id)
      initializedDraftIdRef.current = initialDraft.id

      const newState = deriveInitialState({
        mode,
        thread,
        sourceMessage,
        draft: initialDraft,
        defaultIntegrationId: integrations?.integrations?.[0]?.id,
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
      setIsDraftSaved(true) // Draft was loaded from server
    }
  }, [initialDraft, mode, thread, sourceMessage, integrations, presetValues])
  // Generate temp ID for file uploads before draft exists
  const tempEntityId = useMemo(
    () => state.draftId || `temp-message-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    [state.draftId]
  )
  // File selection hook
  const fileSelect = useFileSelect({
    entityType: 'MESSAGE',
    entityId: tempEntityId,
    allowMultiple: true,
    maxFiles: 10,
    maxFileSize: 25 * 1024 * 1024, // 25MB
    autoStart: true, // Automatically start uploading files when added
    // autoCreateSession removed - sessions are created lazily when files are selected
    onChange: () => {
      // Mark draft as unsaved when files change
      setIsDraftSaved(false)
    },
    onUploadComplete: () => {
      // Update draft saved state after uploads
      setIsDraftSaved(false)
    },
  })
  // Track if we've already initialized attachments to prevent infinite loop
  const attachmentsInitializedRef = useRef(false)
  // Populate fileSelect with initial attachments from draft
  useEffect(() => {
    if (
      initialDraft?.attachments &&
      initialDraft.attachments.length > 0 &&
      !attachmentsInitializedRef.current
    ) {
      const fileSelectItems = transformDraftAttachmentsToFileSelectItems(initialDraft.attachments)
      fileSelect.addItems(fileSelectItems)
      attachmentsInitializedRef.current = true
    }
  }, [initialDraft?.attachments, initialDraft?.id]) // Re-run when draft changes
  // Reset initialization when draft changes
  useEffect(() => {
    attachmentsInitializedRef.current = false
    // Clear existing items when switching drafts
    fileSelect.clearItems()
  }, [initialDraft?.id])
  // Populate fileSelect with preset attachments (only if no draft)
  useEffect(() => {
    if (
      !initialDraft &&
      presetValues?.attachments &&
      presetValues.attachments.length > 0 &&
      !attachmentsInitializedRef.current
    ) {
      const fileSelectItems = presetValues.attachments.map((att) => ({
        id: `preset-${att.id}`,
        name: att.name,
        type: 'file' as const,
        size: att.size ? BigInt(att.size) : null,
        displaySize: Number(att.size || 0),
        mimeType: att.mimeType || null,
        ext: att.name.includes('.') ? `.${att.name.split('.').pop()}` : null,
        createdAt: new Date(),
        updatedAt: new Date(),
        path: '/',
        parentId: null,
        source: (att.type === 'file' ? 'filesystem' : 'upload') as 'filesystem' | 'upload',
        serverFileId: att.id,
        isExistingAttachment: true,
        originalAttachmentId: att.id,
        attachmentType: att.type,
      }))
      fileSelect.addItems(fileSelectItems)
      attachmentsInitializedRef.current = true
    }
  }, [presetValues?.attachments, initialDraft])
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
          deleteDraftRef.current?.(data.id)
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
    onSuccess: () => {
      toastSuccess({ description: 'Message sent successfully' })
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
  // Prepare payload for autosave
  const draftPayload = useMemo(
    () => ({
      threadId: state.threadId,
      integrationId: state.integrationId,
      subject: state.subject,
      textHtml: content,
      signatureId: state.signatureId,
      to: toPayload(recipients.TO),
      cc: toPayload(recipients.CC),
      bcc: toPayload(recipients.BCC),
      attachments: transformToFileAttachments(fileSelect.selectedItems),
      metadata: {
        includePreviousMessage: state.includePrev,
        sourceMessageId: state.sourceMessageId,
      },
      draftId: state.draftId,
    }),
    [state, content, recipients, fileSelect.selectedItems]
  )
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
  const handleSubjectChange = useCallback((subject: string) => {
    setState((prev) => ({ ...prev, subject }))
    setIsDraftSaved(false)
  }, [])
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
  // Calculate if editor has content
  const hasContent = useMemo(() => {
    if (!editor) return false
    return !isContentEmpty(editor)
  }, [editor, content])
  // Check if thread has previous messages
  const hasPreviousMessages = useMemo(() => {
    if (!thread?.messages) return false
    return thread.messages.length > 0
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
    },
    onError: (error) => {
      toastError({
        title: 'AI operation failed',
        description: error.message,
      })
      setError(error.message)
      setProcessing(false)
      setCurrentOperation(null)
    },
  })
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
      // Save current state to history before AI operation
      // This ensures we can undo back to the state before the operation
      pushToHistory(currentContent, `before-${operation}`)
      setProcessing(true)
      setCurrentOperation(operation)
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
    ]
  )
  const handleSendClick = useCallback(async () => {
    if (isSending || !editor?.isEditable) return
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
        attachments: transformToFileAttachments(fileSelect.selectedItems),
        includePreviousMessage: state.includePrev,
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
    fileSelect.selectedItems,
    draftAutosave,
    upsert,
    isUpserting,
    draftPayload,
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
      <div className="transition-background flex flex-col duration-200 ease-in-out relative">
        {/* Header */}
      <div className="absolute top-[-32px] h-full w-full rounded-t-[15px] bg-gray-300  dark:bg-gray-800 ">
        <div className="flex justify-between h-[36px]">
          <div className="ps-4 flex flex-row items-center gap-2">
            <Mail size="16" className="my-1.5 text-foreground" />
            <span className="text-sm">Compose Email</span>
            {isUpserting && (
              <Loader2 className="ml-auto size-4 animate-spin text-muted-foreground" />
            )}
          </div>
          <div className="flex flex-row gap-2 items-center me-1">
            {/* AI Status (undo/redo and processing) */}
            <AIStatus
              state={aiToolsState}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={undo}
              onRedo={redo}
            />
            {isDraftSaved && <span className="text-muted-foreground text-sm">Draft</span>}
            <Button
              size="icon-sm"
              variant="ghost"
              className="rounded-full text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700"
              onClick={handleDiscardClick}
              disabled={isSending || isUpserting || isDeleting}>
              {isDeleting ? <Loader2 className="size-4 animate-spin" /> : <X />}
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
          <div className="absolute inset-[-1px] z-50 flex items-center justify-center rounded-[20px] bg-blue-500/10 border-1 border-dashed border-info">
            <div className="text-center">
              <Upload className="mx-auto size-8 text-blue-500" />
              <Badge variant="blue" className="cursor-default">
                Drop here
              </Badge>
            </div>
          </div>
        )}
        {/* Header Fields */}
        <div className="flex flex-col border-b border-border">
          {/* From Field */}
          <div className="flex items-center gap-2 px-4 py-2">
            <span className="w-10 shrink-0 text-sm text-muted-foreground">From:</span>
            <div className="flex-1">
              <IntegrationSelector
                value={state.integrationId}
                onChange={handleIntegrationChange}
                disabled={isSending}
              />
            </div>
          </div>
          <Separator className="mx-4 w-auto" />

          {/* To Field & Toggles */}
          <div className="flex items-center gap-2 px-4 py-2">
            <span className="w-10 shrink-0 text-sm text-muted-foreground">To:</span>
            <RecipientInput
              recipients={recipients.TO}
              onAdd={(r) => upsertRecipient('TO', r)}
              onRemove={(id) => removeRecipient('TO', id)}
              onContactSelect={(c) => handleContactSelect('TO', c)}
              placeholder="Add recipients..."
              disabled={isSending}
            />
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {!showSubject && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1 text-xs text-info"
                  onClick={() => setShowSubject(true)}
                  disabled={isSending}>
                  Subject
                </Button>
              )}
              {!showCc && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1 text-xs text-info"
                  onClick={() => setShowCc(true)}
                  disabled={isSending}>
                  Cc
                </Button>
              )}
              {!showBcc && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1 text-xs text-info"
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
              <Separator className="mx-4 w-auto" />
              <div className="flex items-center gap-2 px-4 py-2">
                <span className="w-10 shrink-0 text-sm text-muted-foreground">Cc:</span>
                <RecipientInput
                  recipients={recipients.CC}
                  onAdd={(r) => upsertRecipient('CC', r)}
                  onRemove={(id) => removeRecipient('CC', id)}
                  onContactSelect={(c) => handleContactSelect('CC', c)}
                  placeholder="Add Cc recipients..."
                  disabled={isSending}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 px-1 text-xs text-muted-foreground"
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
              <Separator className="mx-4 w-auto" />
              <div className="flex items-center gap-2 px-4 py-2">
                <span className="w-10 shrink-0 text-sm text-muted-foreground">Bcc:</span>
                <RecipientInput
                  recipients={recipients.BCC}
                  onAdd={(r) => upsertRecipient('BCC', r)}
                  onRemove={(id) => removeRecipient('BCC', id)}
                  onContactSelect={(c) => handleContactSelect('BCC', c)}
                  placeholder="Add Bcc recipients..."
                  disabled={isSending}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 px-1 text-xs text-muted-foreground"
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
              <Separator className="mx-4 w-auto" />
              <div className="flex items-center gap-2 px-4 py-2">
                <span className="shrink-0 text-sm text-muted-foreground">Subject:</span>
                <input
                  type="text"
                  className="w-full flex-1 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground/50"
                  value={state.subject}
                  onChange={(e) => handleSubjectChange(e.target.value)}
                  placeholder="Enter subject"
                  disabled={isSending}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 px-1 text-xs text-muted-foreground"
                  onClick={() => setShowSubject(false)}
                  disabled={isSending}>
                  Remove
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Editor Section */}
        <div className="flex flex-col flex-1 min-h-[150px]">
          <TiptapEditor
            content={content}
            onChange={handleContentChange}
            placeholder="Type / to insert a snippet."
            editable={!aiToolsState.isProcessing}
          />
          <SignatureEditor
            integrationId={state.integrationId}
            selectedSignatureId={state.signatureId}
            onSignatureChange={handleSignatureChange}
            disabled={isSending}
          />

          {/* File Attachments Display */}
          {fileSelect.selectedItems.length > 0 && (
            <div className="mx-4 mb-3 mt-2">
              <div className="text-xs text-muted-foreground mb-2">
                Attachments ({fileSelect.selectedItems.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {fileSelect.selectedItems.map((file) => (
                  <MessageFile
                    key={file.id}
                    file={file}
                    showRemoveButton={true}
                    onRemove={() => fileSelect.removeItem(file.id)}
                    className="group"
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
            <div className="px-2">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setState((prev) => ({ ...prev, includePrev: true }))}
                title="Add previous message"
                className="text-muted-foreground/50"
                disabled={isSending}>
                <Plus />
                Add previous message
              </Button>
            </div>
          )}
        </div>

        {/* Toolbar with integrated AI Tools */}
        <div className="editor-toolbar-wrapper px-2 py-1 ">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar md:gap-2">
            <EditorToolbar
              editor={editor}
              onSend={handleSendClick}
              isSending={isSending}
              disabled={isSending || !editor?.isEditable || aiToolsState.isProcessing}
              fileSelect={fileSelect}
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
