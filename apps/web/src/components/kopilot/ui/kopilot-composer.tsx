// apps/web/src/components/kopilot/ui/kopilot-composer.tsx

'use client'

import { ModelType } from '@auxx/lib/ai/providers/types'
import type { PromptTemplateItem } from '@auxx/lib/prompt-templates'
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
import { AiModelPicker, type ModelPickerItem } from '~/components/pickers/ai-model-picker'
import { api } from '~/trpc/react'
import type { KopilotRequest } from '../hooks/use-kopilot-sse'
import { usePromptTemplates } from '../hooks/use-prompt-templates'
import type { KopilotMessage } from '../stores/kopilot-store'
import { useKopilotStore } from '../stores/kopilot-store'
import { PromptFormDialog } from './dialogs/prompt-form-dialog'
import { PromptTemplateDialog } from './dialogs/prompt-template-dialog'
import { PromptTemplatePickerContent } from './pickers/prompt-template-picker/prompt-template-picker-content'

interface KopilotComposerProps {
  ref?: React.Ref<KopilotComposerHandle>
  page: string
  context?: KopilotRequest['context']
  onSend: (request: KopilotRequest) => void
  contentClassName?: string
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

const PROMPT_BADGE_REGEX =
  /<span[^>]*data-type="promptTemplate"[^>]*data-id="([^"]*)"[^>]*>[^<]*<\/span>/g

/**
 * Resolve prompt template badges in HTML to their full prompt text for the API.
 */
function resolvePromptBadges(html: string, templateMap: Map<string, string>): string {
  return html.replace(PROMPT_BADGE_REGEX, (_match, id: string) => templateMap.get(id) ?? '')
}

/**
 * Replace prompt template badge spans with styled static HTML for chat display.
 * Renders a compact pill with colored dot + template name.
 */
function formatPromptBadgesForDisplay(
  html: string,
  templates: Map<string, { name: string; icon?: { iconId: string; color: string } | null }>
): string {
  return html.replace(PROMPT_BADGE_REGEX, (_match, id: string) => {
    const template = templates.get(id)
    if (!template) return ''
    const iconHtml = template.icon
      ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${template.icon.color};flex-shrink:0;"></span>`
      : ''
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:9999px;background:#f0f0f0;font-size:12px;font-weight:500;line-height:1.4;">${iconHtml}${template.name}</span>`
  })
}

export function KopilotComposer({
  ref,
  page,
  context,
  onSend,
  contentClassName,
}: KopilotComposerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const handleSendRef = useRef<() => void>(() => {})

  const isStreaming = useKopilotStore((s) => s.isStreaming)
  const activeSessionId = useKopilotStore((s) => s.activeSessionId)
  const addMessage = useKopilotStore((s) => s.addMessage)
  const messages = useKopilotStore((s) => s.messages)
  const editingMessageId = useKopilotStore((s) => s.editingMessageId)
  const setEditingMessage = useKopilotStore((s) => s.setEditingMessage)
  const messageMap = useKopilotStore((s) => s.messageMap)
  const selectedModelId = useKopilotStore((s) => s.selectedModelId)
  const setSelectedModelId = useKopilotStore((s) => s.setSelectedModelId)

  // Resolve system LLM default to show in picker when no override is selected
  const { data: systemDefaults } = api.aiIntegration.getSystemModelDefaults.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  })
  const systemLlmDefault = useMemo(() => {
    const llmDefault = systemDefaults?.find((d) => d.modelType === ModelType.LLM)
    return llmDefault ? `${llmDefault.provider}:${llmDefault.model}` : null
  }, [systemDefaults])

  /** Filter models to only those supporting structured output + tool calling (required by Kopilot) */
  const handleModelFilter = useCallback(
    (model: ModelPickerItem | null) => {
      setSelectedModelId(model?.id ?? null)
    },
    [setSelectedModelId]
  )

  const { templates } = usePromptTemplates()
  const templateMap = useMemo(() => new Map(templates.map((t) => [t.id, t.prompt])), [templates])
  const templateDisplayMap = useMemo(
    () => new Map(templates.map((t) => [t.id, { name: t.name, icon: t.icon }])),
    [templates]
  )

  const [isEmpty, setIsEmpty] = useState(true)
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)
  const [browseDialogOpen, setBrowseDialogOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplateItem | null>(null)

  // Slash command hook — creates extension to add to editor
  const {
    suggestionState: slashSuggestionState,
    isOpenRef: slashIsOpenRef,
    executeCommand: slashExecuteCommand,
    closePicker: slashClosePicker,
    slashCommandExtension,
    setEditor: slashSetEditor,
  } = useSlashCommand()

  // Stable ref for badge edit handler (avoids recreating TipTap extension)
  const handleBadgeEditRef = useRef<(id: string) => void>(() => {})
  handleBadgeEditRef.current = (id: string) => {
    const template = templates.find((t) => t.id === id)
    if (template) setEditingTemplate(template)
  }

  // Prompt template inline node extension
  const promptNodeExtension = useMemo(
    () =>
      createPromptNode(({ id, selected }) => (
        <PromptTemplateBadge
          id={id}
          selected={selected}
          onEdit={(id) => handleBadgeEditRef.current(id)}
        />
      )),
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

    // Optimistic: add user message to store (with styled badges for display)
    const displayHtml = formatPromptBadgesForDisplay(html, templateDisplayMap)
    const userMessage: KopilotMessage = {
      id: generateId(),
      role: 'user',
      content: displayHtml,
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
      modelId: selectedModelId ?? undefined,
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
    templateDisplayMap,
    selectedModelId,
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
    <div ref={containerRef} className={cn('p-3', contentClassName)}>
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
              onEditRequest={setEditingTemplate}
              onBrowseRequest={() => {
                slashClosePicker()
                setBrowseDialogOpen(true)
              }}
            />
          </InlinePickerPopover>
        </div>
        <div className='absolute bottom-1 left-1'>
          <AiModelPicker
            value={selectedModelId ?? systemLlmDefault}
            onChange={handleModelFilter}
            modelTypes={[ModelType.LLM]}
            triggerVariant='transparent'
            triggerClassName='h-7 text-xs text-muted-foreground'
            compact
          />
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
      {editingTemplate && (
        <PromptFormDialog
          open={!!editingTemplate}
          onOpenChange={(open) => {
            if (!open) setEditingTemplate(null)
          }}
          mode='edit'
          promptTemplate={editingTemplate}
        />
      )}
      {browseDialogOpen && (
        <PromptTemplateDialog open={browseDialogOpen} onOpenChange={setBrowseDialogOpen} />
      )}
    </div>
  )
}
