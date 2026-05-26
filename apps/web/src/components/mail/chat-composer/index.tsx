// apps/web/src/components/mail/chat-composer/index.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Upload } from 'lucide-react'
import type React from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { EditorToolbar } from '~/components/editor/editor-button'
import { EditorProvider, useEditorContext } from '~/components/editor/editor-context'
import { useFileSelect } from '~/components/file-select/hooks/use-file-select'
import { api } from '~/trpc/react'
import {
  AI_OPERATION,
  type AIOperation,
  COMPOSE_ENTITY_TYPE,
  OUTPUT_FORMAT,
} from '~/types/ai-tools'
import { ChatPanelHeader } from '../chat-panel/header'
import {
  EditorActiveStateProvider,
  useEditorActiveStateContext,
} from '../email-editor/editor-active-state-context'
import { useAIToolsState } from '../email-editor/hooks'
import { LazyTiptapEditor } from '../email-editor/lazy-tiptap-editor'
import { MessageFile } from '../email-editor/message-file'
import type { FileAttachment } from '../email-editor/types'
import type { ChatComposerProps } from './types'
import { useChatSend } from './use-chat-send'

const INTERACTIVE_ELEMENT_SELECTORS = `
  button, a, input, select, textarea,
  [role="button"], [role="option"], [role="combobox"], [role="menuitem"], [role="tab"],
  .ProseMirror, [data-radix-popper-content-wrapper], [data-radix-select-trigger],
  .tippy-box, .editor-toolbar-wrapper
`.trim()

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

function ChatComposerInner({
  thread,
  onClose,
  onSendSuccess,
  isDialogMode = false,
  onPopOut,
  onMinimize,
  onDockBack,
  hideHeader = false,
  dragHandleProps,
}: ChatComposerProps) {
  const popoverZIndex = isDialogMode ? 'z-[200]' : undefined
  const { editor } = useEditorContext()
  const activeState = useEditorActiveStateContext()

  const [content, setContent] = useState('')
  const [attachments, setAttachments] = useState<FileAttachment[]>([])

  const tempEntityId = useMemo(
    () => `temp-message-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    []
  )
  const fileSelect = useFileSelect({
    entityType: 'MESSAGE',
    entityId: tempEntityId,
    allowMultiple: true,
    maxFiles: 10,
    maxFileSize: 25 * 1024 * 1024,
    autoStart: true,
  })

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => fileSelect.addFiles(acceptedFiles),
    noClick: true,
    noKeyboard: true,
  })

  const integrationId = thread.integrationId ?? ''
  const { send, isSending } = useChatSend({
    threadId: thread.id,
    integrationId,
    onSendSuccess: () => {
      editor?.commands.clearContent(true)
      setContent('')
      setAttachments([])
      onSendSuccess()
    },
  })

  const allAttachments = useMemo(() => {
    const filesFromSelect: FileAttachment[] = fileSelect.selectedItems
      .filter((item) => item.source === 'filesystem' || item.serverFileId)
      .map((item) => ({
        id: item.source === 'filesystem' ? item.id : item.serverFileId!,
        name: item.name,
        size: Number(item.size ?? 0),
        mimeType: item.mimeType || 'application/octet-stream',
        type: 'file' as const,
      }))
    const existingIds = new Set(attachments.map((a) => a.id))
    return [...attachments, ...filesFromSelect.filter((f) => !existingIds.has(f.id))]
  }, [attachments, fileSelect.selectedItems])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const handleSendClick = useCallback(() => {
    if (isSending || !editor?.isEditable) return
    if (!integrationId) {
      toastError({ title: 'Missing channel', description: 'No chat channel for this thread.' })
      return
    }
    const plainContent = editor?.getText()?.trim() ?? ''
    if (!plainContent) {
      toastError({ title: 'Empty message', description: 'Type something before sending.' })
      return
    }
    send({ textHtml: content, attachments: allAttachments })
  }, [isSending, editor, integrationId, content, allAttachments, send])

  const handleContentChange = useCallback((next: string) => {
    setContent((prev) => (prev === next ? prev : next))
  }, [])

  // AI tools
  const {
    state: aiToolsState,
    pushToHistory,
    setProcessing,
    setCurrentOperation,
    setError,
    clearError,
  } = useAIToolsState(editor)
  const aiStartTimeRef = useRef<number>(0)

  const processAI = api.aiFeature.compose.useMutation({
    onSuccess: (response) => {
      if (!editor) return
      const html =
        response.format === OUTPUT_FORMAT.EDITOR
          ? null
          : response.format === OUTPUT_FORMAT.HTML
            ? response.content
            : `<p>${response.content}</p>`
      if (response.format === OUTPUT_FORMAT.EDITOR) {
        editor.commands.setContent(JSON.parse(response.content))
      } else if (html !== null) {
        editor.commands.setContent(html)
      }
      const next = editor.getHTML()
      handleContentChange(next)
      pushToHistory(next, aiToolsState.currentOperation)
      setProcessing(false)
      setCurrentOperation(null)
      clearError()
    },
    onError: (error) => {
      toastError({ title: 'AI operation failed', description: error.message })
      setError(error.message)
      setProcessing(false)
      setCurrentOperation(null)
    },
  })

  const handleAIOperation = useCallback(
    async (operation: AIOperation, options?: { tone?: string; language?: string }) => {
      if (!editor || aiToolsState.isProcessing) return
      const currentContent = editor.getHTML()
      if (operation !== AI_OPERATION.COMPOSE && !currentContent.replace(/<[^>]*>/g, '').trim()) {
        toastError({ title: 'No content', description: 'Add content before using AI tools.' })
        return
      }
      pushToHistory(currentContent, `before-${operation}`)
      setProcessing(true)
      setCurrentOperation(operation)
      aiStartTimeRef.current = Date.now()
      await processAI.mutateAsync({
        operation,
        messageHtml: currentContent,
        entityType: COMPOSE_ENTITY_TYPE.THREAD,
        entityId: thread.id,
        senderId: 'current-user',
        output: OUTPUT_FORMAT.HTML,
        ...options,
      })
    },
    [
      editor,
      aiToolsState.isProcessing,
      thread.id,
      processAI,
      setProcessing,
      setCurrentOperation,
      pushToHistory,
    ]
  )

  const hasContent = useMemo(() => {
    if (!editor) return false
    return !isContentEmpty(editor)
  }, [editor, content])

  const handleWrapperClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!editor || editor.isDestroyed || editor.isFocused || isSending) return
      const target = event.target as Element
      if (target.closest(INTERACTIVE_ELEMENT_SELECTORS)) return
      editor.commands.focus('end')
    },
    [editor, isSending]
  )

  return (
    <div
      className={cn(
        'transition-background flex flex-col duration-200 ease-in-out relative',
        !hideHeader && 'bg-gray-300 dark:bg-gray-800 rounded-[15px] shadow-lg'
      )}>
      {/* Header */}
      {!hideHeader && (
        <ChatPanelHeader
          threadId={thread.id}
          isDialogMode={isDialogMode}
          onClose={onClose}
          onPopOut={onPopOut}
          onMinimize={onMinimize}
          onDockBack={onDockBack}
          dragHandleProps={dragHandleProps}
        />
      )}

      {/* Body */}
      <div
        {...getRootProps()}
        className={cn(
          'relative flex flex-col border border-transparent ring-2 ring-transparent bg-white dark:bg-background',
          hideHeader ? 'rounded-[20px] shadow-lg m-1 mt-0' : 'rounded-[12px] m-1 mt-0',
          'focus-within:ring-blue-500 focus-within:hover:bg-white focus-within:hover:border-transparent dark:hover:bg-background',
          activeState.isActive && 'ring-blue-500 hover:bg-white hover:border-transparent',
          isDragActive && 'border-transparent bg-white hover:bg-white hover:border-transparent'
        )}
        onClick={handleWrapperClick}
        onFocus={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            activeState.setHasFocus(true)
          }
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            setTimeout(() => activeState.setHasFocus(false), 0)
          }
        }}>
        <input {...getInputProps()} />

        {isDragActive && (
          <div
            className={cn(
              'absolute inset-[-1px] z-50 flex items-center justify-center bg-blue-500/10 border-1 border-dashed border-info',
              hideHeader ? 'rounded-[20px]' : 'rounded-[12px]'
            )}>
            <div className='text-center'>
              <Upload className='mx-auto size-8 text-blue-500' />
              <Badge variant='blue' className='cursor-default'>
                Drop here
              </Badge>
            </div>
          </div>
        )}

        <div className='flex flex-col flex-1 min-h-[60px]'>
          <LazyTiptapEditor
            content={content}
            onChange={handleContentChange}
            placeholder='Type your reply...'
            editable={!aiToolsState.isProcessing && !isSending}
            popoverClassName={popoverZIndex}
            onEnter={handleSendClick}
            contentClassName='sm:min-h-[60px] py-2 text-sm'
          />

          {(attachments.length > 0 || fileSelect.selectedItems.length > 0) && (
            <div className='mx-4 mb-3 mt-2'>
              <div className='text-xs text-muted-foreground mb-2'>
                Attachments ({attachments.length + fileSelect.selectedItems.length})
              </div>
              <div className='flex flex-wrap gap-2'>
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
        </div>

        {/* Toolbar — AI Tools + Attachments + Send */}
        <div className='editor-toolbar-wrapper relative px-2 py-1'>
          <div className='flex items-center gap-1 shrink-0 no-scrollbar md:gap-2'>
            <EditorToolbar
              editor={editor}
              onSend={handleSendClick}
              isSending={isSending}
              disabled={isSending || !editor?.isEditable || aiToolsState.isProcessing}
              fileSelect={fileSelect}
              showFormatting={false}
              allowSchedule={false}
              showMetaShortcut={false}
              popoverClassName={popoverZIndex}
              aiToolsProps={{
                threadId: thread.id,
                hasContent,
                hasPreviousMessages: (thread.messageCount ?? thread.messages?.length ?? 0) > 0,
                state: aiToolsState,
                onOperation: handleAIOperation,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

const ChatComposer = (props: ChatComposerProps) => (
  <EditorActiveStateProvider>
    <EditorProvider>
      <ChatComposerInner {...props} />
    </EditorProvider>
  </EditorActiveStateProvider>
)

export default ChatComposer
