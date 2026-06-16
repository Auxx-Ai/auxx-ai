// apps/web/src/components/mail/chat-composer/index.tsx
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import type { JSONContent } from '@tiptap/core'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorToolbar } from '~/components/editor/editor-button'
import { EditorProvider, useEditorContext } from '~/components/editor/editor-context'
import { ChatPanelHeader } from '../chat-panel/header'
import {
  AttachmentStrip,
  ComposerBody,
  INTERACTIVE_ELEMENT_SELECTORS,
  isContentEmpty,
  useComposerAITools,
  useComposerAttachments,
} from '../composer-shared'
import { EMPTY_DOC } from '../email-editor/derive-initial'
import { EditorActiveStateProvider } from '../email-editor/editor-active-state-context'
import type { ChatComposerProps } from './types'
import { useChatSend } from './use-chat-send'

function ChatComposerInner({
  thread,
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

  const [content, setContent] = useState<JSONContent>(EMPTY_DOC)

  const { fileSelect, allAttachments, removeAttachment, dropzone } = useComposerAttachments()

  const integrationId = thread.integrationId ?? ''
  const { send, isSending } = useChatSend({
    threadId: thread.id,
    integrationId,
    onSendSuccess: () => {
      editor?.commands.clearContent(true)
      setContent(EMPTY_DOC)
      onSendSuccess()
    },
  })

  // Keep focus in the editor across a send. The editor's `editable` flag
  // flips false while `isSending` is true, which makes the browser blur the
  // contenteditable element; calling `focus()` synchronously inside
  // `onSendSuccess` is too early because the re-enable hasn't rendered yet.
  // Watching the falling edge of `isSending` runs after the editor has flipped
  // back to `editable`, so focus sticks. Critical for the chat experience —
  // an agent typing rapid replies shouldn't have to click back into the box.
  const wasSendingRef = useRef(false)
  useEffect(() => {
    if (wasSendingRef.current && !isSending) {
      editor?.commands.focus('end')
    }
    wasSendingRef.current = isSending
  }, [isSending, editor])

  const handleContentChange = useCallback((next: JSONContent) => {
    setContent(next)
  }, [])

  const handleSendClick = useCallback(() => {
    if (isSending || !editor?.isEditable) return
    if (!integrationId) {
      toastError({ title: 'Missing channel', description: 'No chat channel for this thread.' })
      return
    }
    const plainContent = editor?.getText() ?? ''
    const hasAttachment = allAttachments.length > 0
    if (!plainContent.trim() && !hasAttachment) {
      toastError({
        title: 'Empty message',
        description: 'Type something or attach a file before sending.',
      })
      return
    }
    send({ textHtml: editor.getHTML(), textPlain: plainContent, attachments: allAttachments })
  }, [isSending, editor, integrationId, allAttachments, send])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.metaKey && event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        handleSendClick()
      }
    },
    [handleSendClick]
  )

  const { state: aiToolsState, handleAIOperation } = useComposerAITools({
    editor,
    entityId: thread.id,
    applyContent: (next) =>
      editor?.commands.setContent(
        next as Parameters<NonNullable<typeof editor>['commands']['setContent']>[0]
      ),
    onContentChanged: handleContentChange,
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: content triggers recalculation when editor content changes
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
          onPopOut={onPopOut}
          onMinimize={onMinimize}
          onDockBack={onDockBack}
          dragHandleProps={dragHandleProps}
        />
      )}

      <ComposerBody
        content={content}
        onContentChange={handleContentChange}
        placeholder='Type your reply...'
        editable={!aiToolsState.isProcessing && !isSending}
        popoverClassName={popoverZIndex}
        contentClassName='sm:min-h-[60px] py-2 text-sm'
        editorMinHeightClassName='min-h-[60px]'
        onWrapperClick={handleWrapperClick}
        onKeyDown={handleKeyDown}
        dropzone={dropzone}
        rounded={hideHeader ? 'lg' : 'sm'}
        frameClassName={hideHeader ? 'shadow-lg' : undefined}
        belowEditor={
          <AttachmentStrip
            attachments={[]}
            selectedItems={fileSelect.selectedItems}
            onRemoveAttachment={removeAttachment}
            onRemoveUpload={fileSelect.removeItem}
          />
        }
        toolbar={
          <div className='flex items-center gap-1 shrink-0 no-scrollbar md:gap-2'>
            <EditorToolbar
              editor={editor}
              onSend={handleSendClick}
              isSending={isSending}
              disabled={isSending || !editor?.isEditable || aiToolsState.isProcessing}
              fileSelect={fileSelect}
              showFormatting={false}
              allowSchedule={false}
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
        }
      />
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
