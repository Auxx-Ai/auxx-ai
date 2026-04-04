// apps/web/src/components/kopilot/ui/kopilot-composer.tsx

'use client'

import AiThinking from '@auxx/ui/components/ai-thinking'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { generateId } from '@auxx/utils/generateId'
import { EditorContent } from '@tiptap/react'
import { CornerDownLeft, Send, SquareSlash, X } from 'lucide-react'
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  createPromptNode,
  InlinePickerPopover,
  PromptTemplateBadge,
  useMentionEditor,
  useSlashCommand,
} from '~/components/editor/inline-picker'
import { SubmitOnEnter } from '~/components/global/comments/comment-composer'
import { Tooltip } from '~/components/global/tooltip'
import { ActorPickerContent } from '~/components/pickers/actor-picker/actor-picker-content'
import type { KopilotRequest } from '../hooks/use-kopilot-sse'
import { usePromptTemplates } from '../hooks/use-prompt-templates'
import type { KopilotMessage } from '../stores/kopilot-store'
import { useKopilotStore } from '../stores/kopilot-store'
import { PromptFormDialog } from './dialogs/prompt-form-dialog'
import { PromptTemplatePickerContent } from './pickers/prompt-template-picker/prompt-template-picker-content'

interface KopilotComposerProps {
  ref?: React.Ref<KopilotComposerHandle>
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

/**
 * Resolve prompt template badges in HTML to their full prompt text.
 * Replaces <span data-type="promptTemplate" data-id="...">...</span> with the prompt content.
 */
function resolvePromptBadges(html: string, templateMap: Map<string, string>): string {
  return html.replace(
    /<span[^>]*data-type="promptTemplate"[^>]*data-id="([^"]*)"[^>]*>[^<]*<\/span>/g,
    (_match, id: string) => templateMap.get(id) ?? ''
  )
}

export function KopilotComposer({ ref, page, context, onSend }: KopilotComposerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const handleSendRef = useRef<() => void>(() => {})

  const isStreaming = useKopilotStore((s) => s.isStreaming)
  const activeSessionId = useKopilotStore((s) => s.activeSessionId)
  const addMessage = useKopilotStore((s) => s.addMessage)
  const messages = useKopilotStore((s) => s.messages)
  const editingMessageId = useKopilotStore((s) => s.editingMessageId)
  const setEditingMessage = useKopilotStore((s) => s.setEditingMessage)
  const messageMap = useKopilotStore((s) => s.messageMap)

  const { templates } = usePromptTemplates()
  const templateMap = useMemo(() => new Map(templates.map((t) => [t.id, t.prompt])), [templates])

  const [isEmpty, setIsEmpty] = useState(true)
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)

  // Slash command hook — creates extension to add to editor
  const {
    suggestionState: slashSuggestionState,
    isOpenRef: slashIsOpenRef,
    executeCommand: slashExecuteCommand,
    closePicker: slashClosePicker,
    slashCommandExtension,
    setEditor: slashSetEditor,
  } = useSlashCommand()

  // Prompt template inline node extension
  const promptNodeExtension = useMemo(
    () =>
      createPromptNode(({ id, selected }) => <PromptTemplateBadge id={id} selected={selected} />),
    []
  )

  const mentionEditor = useMentionEditor({
    placeholder: 'Ask Kopilot...',
    editable: true,
    className: cn('prose prose-sm prose-p:my-0 focus:outline-hidden max-w-none dark:prose-invert'),
    onUpdate: (html) => {
      const empty = isEmptyContent(html)
      setIsEmpty((prev) => (prev === empty ? prev : empty))
    },
    extensions: [
      SubmitOnEnter.configure({
        isExpanded: () => false,
        onSubmit: () => {
          // Don't submit if slash picker is open
          if (slashIsOpenRef.current) return
          handleSendRef.current()
        },
      }),
      slashCommandExtension,
      promptNodeExtension,
    ],
  })

  const { editor, suggestionState, insertMention, closePicker } = mentionEditor

  // Wire slash command to editor once created
  useEffect(() => {
    slashSetEditor(editor)
  }, [editor, slashSetEditor])

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        if (editor) {
          editor.commands.focus('end')
        }
      },
    }),
    [editor]
  )

  const handleSend = useCallback(() => {
    if (!editor || isStreaming) return

    const html = editor.getHTML()
    if (isEmptyContent(html)) return

    // Resolve prompt template badges to full prompt text
    const resolvedHtml = resolvePromptBadges(html, templateMap)

    // Get plain text from resolved content for the API
    // Create a temp element to extract text from resolved HTML
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = resolvedHtml
    const text = tempDiv.textContent ?? tempDiv.innerText ?? ''

    // Determine parentId for tree structure
    let parentId: string | null = null
    if (editingMessageId) {
      parentId = messageMap[editingMessageId]?.parentId ?? null
    } else {
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
      message: text.trim(),
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
    templateMap,
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

  const handleInsertSlash = useCallback(() => {
    if (!editor) return
    editor.chain().focus('end').insertContent('/').run()
  }, [editor])

  return (
    <div ref={containerRef} className='p-3'>
      <div className='relative flex flex-row items-end rounded-xl border min-h-[120px] bg-primary-150  focus-within:border-info'>
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
          {/* Mention picker (@) */}
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
          {/* Slash command picker (/) */}
          <InlinePickerPopover
            state={slashSuggestionState}
            containerRef={containerRef}
            width={280}
            onClose={slashClosePicker}>
            <PromptTemplatePickerContent
              onSelect={(template) => {
                slashExecuteCommand((editor, range) => {
                  editor
                    .chain()
                    .focus()
                    .deleteRange(range)
                    .insertContent({
                      type: 'promptTemplate',
                      attrs: { id: template.id },
                    })
                    .insertContent(' ')
                    .run()
                })
              }}
              onCreateRequest={() => setPromptDialogOpen(true)}
            />
          </InlinePickerPopover>
        </div>
        <div className='absolute bottom-1 right-1 flex items-center gap-0.5'>
          <Tooltip content='Insert prompt template' shortcut='/'>
            <Button
              size='icon-sm'
              variant='ghost'
              className='shrink-0'
              onClick={handleInsertSlash}
              disabled={isStreaming}
              title='Insert prompt template'>
              <SquareSlash />
            </Button>
          </Tooltip>
          <Tooltip content='Send message' shortcut={<CornerDownLeft className='size-4' />}>
            <Button
              size='icon-sm'
              variant='ghost'
              className='shrink-0'
              onClick={handleSend}
              disabled={isStreaming || isEmpty}>
              <Send />
            </Button>
          </Tooltip>
        </div>
      </div>
      {promptDialogOpen && (
        <PromptFormDialog
          open={promptDialogOpen}
          onOpenChange={setPromptDialogOpen}
          mode='create'
        />
      )}
    </div>
  )
}
