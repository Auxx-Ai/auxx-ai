// apps/web/src/components/kopilot/ui/kopilot-composer.tsx

'use client'

import AiThinking from '@auxx/ui/components/ai-thinking'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { generateId } from '@auxx/utils/generateId'
import { EditorContent } from '@tiptap/react'
import { Send, X } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { InlinePickerPopover, useMentionEditor } from '~/components/editor/inline-picker'
import { SubmitOnEnter } from '~/components/global/comments/comment-composer'
import { ActorPickerContent } from '~/components/pickers/actor-picker/actor-picker-content'
import type { KopilotRequest } from '../hooks/use-kopilot-sse'
import type { KopilotMessage } from '../stores/kopilot-store'
import { useKopilotStore } from '../stores/kopilot-store'

interface KopilotComposerProps {
  page: string
  context?: KopilotRequest['context']
  onSend: (request: KopilotRequest) => void
}

export interface KopilotComposerHandle {
  focus: () => void
}

function isEmptyContent(html: string): boolean {
  if (!html) return true
  return (
    html
      .replace(/<p[^>]*>/g, '')
      .replace(/<\/p>/g, '')
      .trim() === ''
  )
}

export const KopilotComposer = forwardRef<KopilotComposerHandle, KopilotComposerProps>(
  function KopilotComposer({ page, context, onSend }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const handleSendRef = useRef<() => void>(() => {})

    const isStreaming = useKopilotStore((s) => s.isStreaming)
    const activeSessionId = useKopilotStore((s) => s.activeSessionId)
    const addMessage = useKopilotStore((s) => s.addMessage)
    const messages = useKopilotStore((s) => s.messages)
    const editingMessageId = useKopilotStore((s) => s.editingMessageId)
    const setEditingMessage = useKopilotStore((s) => s.setEditingMessage)
    const messageMap = useKopilotStore((s) => s.messageMap)

    const [isEmpty, setIsEmpty] = useState(true)

    const mentionEditor = useMentionEditor({
      placeholder: 'Ask Kopilot...',
      editable: true,
      className: cn(
        'prose prose-sm prose-p:my-0 focus:outline-hidden max-w-none dark:prose-invert'
      ),
      onUpdate: (html) => {
        const empty = isEmptyContent(html)
        setIsEmpty((prev) => (prev === empty ? prev : empty))
      },
      extensions: [
        SubmitOnEnter.configure({
          isExpanded: () => false,
          onSubmit: () => handleSendRef.current(),
        }),
      ],
    })

    const { editor, suggestionState, insertMention, closePicker } = mentionEditor

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          console.log(
            '[KopilotComposer] focus called, editor:',
            !!editor,
            'editable:',
            editor?.isEditable
          )
          if (editor) {
            editor.commands.focus('end')
            console.log('[KopilotComposer] focus command sent, isFocused:', editor.isFocused)
          }
        },
      }),
      [editor]
    )

    const handleSend = useCallback(() => {
      if (!editor || isStreaming) return

      const html = editor.getHTML()
      if (isEmptyContent(html)) return

      const text = editor.getText()

      // Determine parentId for tree structure
      let parentId: string | null = null
      if (editingMessageId) {
        // Editing: new message shares parent with the original (creates sibling branch)
        parentId = messageMap[editingMessageId]?.parentId ?? null
      } else {
        // Normal: parent is last visible message
        parentId = messages.length > 0 ? messages[messages.length - 1]!.id : null
      }

      // Optimistic: add user message to store
      const userMessage: KopilotMessage = {
        id: generateId(),
        role: 'user',
        content: html,
        timestamp: Date.now(),
        parentId,
      }
      addMessage(userMessage)

      // Build request
      onSend({
        sessionId: activeSessionId ?? undefined,
        message: text,
        type: 'message',
        page,
        context,
      })

      // Clear edit state and editor
      if (editingMessageId) {
        setEditingMessage(null)
      }
      editor.commands.clearContent()
    }, [
      editor,
      isStreaming,
      activeSessionId,
      addMessage,
      onSend,
      page,
      context,
      editingMessageId,
      setEditingMessage,
      messageMap,
      messages,
    ])

    // Keep ref in sync
    handleSendRef.current = handleSend

    // Populate editor when editing a message
    useEffect(() => {
      if (editingMessageId && editor) {
        const msg = messages.find((m) => m.id === editingMessageId)
        if (msg) {
          editor.commands.setContent(msg.content)
          editor.commands.focus('end')
        }
      }
    }, [editingMessageId, editor, messages])

    const handleCancelEdit = useCallback(() => {
      setEditingMessage(null)
      editor?.commands.clearContent()
    }, [setEditingMessage, editor])

    return (
      <div ref={containerRef} className='p-3'>
        <div className='relative flex flex-row items-end rounded-xl border min-h-[120px]'>
          <div className='relative flex flex-1 flex-col self-stretch'>
            {editingMessageId && (
              <div className='flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground'>
                <span>Editing message</span>
                <Button variant='ghost' size='icon' className='h-5 w-5' onClick={handleCancelEdit}>
                  <X className='size-3' />
                </Button>
              </div>
            )}
            <EditorContent
              editor={editor}
              className={cn('w-full flex flex-col px-3 py-2 text-sm flex-1 [&>.prose]:flex-1')}
            />
            <InlinePickerPopover
              state={suggestionState}
              containerRef={containerRef}
              width={280}
              onClose={closePicker}>
              <ActorPickerContent
                value={[]}
                onChange={() => {}}
                target='user'
                multi={false}
                onSelectSingle={(actorId) => insertMention(actorId)}
                placeholder='Search team members...'
              />
            </InlinePickerPopover>
          </div>
          <div className='absolute bottom-1 right-1'>
            <Button
              size='icon'
              variant='ghost'
              className='shrink-0 rounded-full'
              onClick={handleSend}
              disabled={isStreaming || isEmpty}>
              <Send />
            </Button>
          </div>
        </div>
      </div>
    )
  }
)
