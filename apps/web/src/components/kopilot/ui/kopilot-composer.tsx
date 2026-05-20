// apps/web/src/components/kopilot/ui/kopilot-composer.tsx

'use client'

import { ModelType } from '@auxx/lib/ai/providers/types'
import type { DocJSON } from '@auxx/lib/kb/markdown'
import type { PromptTemplateItem } from '@auxx/lib/prompt-templates'
import { docToText } from '@auxx/lib/tiptap'
import { type ActorId, parseActorId } from '@auxx/types/actor'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { generateId } from '@auxx/utils/generateId'
import { Extension } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { Bot, ChevronsUpDown, CornerDownLeft, Send, SquareSlash, X } from 'lucide-react'
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  createPromptNode,
  InlinePickerPopover,
  PromptTemplateBadge,
  useActivePicker,
  useReferencePickerEditor,
  useSlashCommand,
} from '~/components/editor/inline-picker'
import { SubmitOnEnter } from '~/components/global/comments/comment-composer'
import { Tooltip } from '~/components/global/tooltip'
import { ActorPickerContent } from '~/components/pickers/actor-picker/actor-picker-content'
import { AiModelPicker, type ModelPickerItem } from '~/components/pickers/ai-model-picker'
import {
  ReferencePickerContent,
  type ReferencePickerHandle,
} from '~/components/pickers/reference-picker/reference-picker-content'
import { useActor } from '~/components/resources/hooks/use-actor'
import { api } from '~/trpc/react'
import { KopilotContextChipStrip } from '../context/kopilot-context-chip-strip'
import type { SessionRef, SessionRefKind } from '../context/types'
import type { KopilotRequest } from '../hooks/use-kopilot-sse'
import { usePromptTemplates } from '../hooks/use-prompt-templates'
import { useKopilotChatOptions } from '../options'
import type { KopilotMessage } from '../stores/kopilot-store'
import { useKopilotStore } from '../stores/kopilot-store'
import { applyChipDismissals, selectMergedContext } from '../stores/select-context'
import { PromptFormDialog } from './dialogs/prompt-form-dialog'
import { PromptTemplateDialog } from './dialogs/prompt-template-dialog'
import { KopilotReplyChipStrip } from './kopilot-reply-chip-strip'
import { PromptTemplatePickerContent } from './pickers/prompt-template-picker/prompt-template-picker-content'

interface KopilotComposerProps {
  ref?: React.Ref<KopilotComposerHandle>
  /**
   * Page identifier — fallback when no `<KopilotContext page="...">` mount has
   * registered one. Merged store wins when both are present.
   */
  page: string
  onSend: (request: KopilotRequest) => void
  contentClassName?: string
}

export interface KopilotComposerHandle {
  focus: () => void
  /**
   * Replace editor content with `text` (wrapped in a paragraph) and focus the
   * end. Used by suggestion clicks where `autoSubmit` is false — the user
   * edits before sending.
   */
  populate: (text: string) => void
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

const REFERENCE_BADGE_REGEX =
  /<span[^>]*data-type="reference"[^>]*data-id="([^"]+)"[^>]*>[^<]*<\/span>/g

/**
 * Derive a `SessionRefKind` from a reference id prefix. Mirrors the
 * `renderReferenceBadge` heuristic in `use-reference-picker-editor.tsx` so
 * the extractor and the badge renderer agree on what a given id means.
 */
function kindFromMentionId(id: string): SessionRefKind {
  if (id.startsWith('user:') || id.startsWith('group:')) return 'actor'
  if (id.startsWith('thread:') || id.startsWith('draft:')) return 'thread'
  if (id.startsWith('article:')) return 'article'
  return 'record'
}

function extractMentionRefs(html: string): SessionRef[] {
  const refs: SessionRef[] = []
  let match: RegExpExecArray | null
  REFERENCE_BADGE_REGEX.lastIndex = 0
  while ((match = REFERENCE_BADGE_REGEX.exec(html)) !== null) {
    const id = match[1]!
    refs.push({ kind: kindFromMentionId(id), id, origin: 'mention' })
  }
  return refs
}

/**
 * Resolve prompt template badges in HTML to their full prompt text for the API.
 * Each badge's `DocJSON` body is flattened via `docToText` — inline reference
 * chips inside the template inline as `[reference](id)` so the model sees a
 * coherent natural-language prompt with id-bearing tags.
 */
function resolvePromptBadges(html: string, templateMap: Map<string, DocJSON>): string {
  return html.replace(PROMPT_BADGE_REGEX, (_match, id: string) => {
    const doc = templateMap.get(id)
    if (!doc) return ''
    return docToText(doc)
  })
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

interface SenderHotkeyOptions {
  /**
   * Called when `#` (Shift+3) is pressed. Return `true` to consume the
   * keystroke (the `#` character is not inserted). Return `false` to let
   * the character pass through to normal text input — used in the locked
   * state where the session is pinned to one agent.
   */
  onTrigger: () => boolean
}

/**
 * Tiptap extension that intercepts `#` (Shift+3) to open the composer's
 * sender picker. Mirrors the slash-command picker's `/` hotkey but
 * targets a different surface — see plans/kopilot/agents/dm/plan.md.
 */
const SenderHotkey = Extension.create<SenderHotkeyOptions>({
  name: 'senderHotkey',
  addOptions() {
    return { onTrigger: () => false }
  },
  addKeyboardShortcuts() {
    return {
      'Shift-3': () => this.options.onTrigger(),
    }
  },
})

export function KopilotComposer({ ref, page, onSend, contentClassName }: KopilotComposerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const handleSendRef = useRef<() => void>(() => {})

  const {
    placeholder,
    allowModelPicker,
    allowSenderPicker,
    allowSlashCommands,
    allowReferencePicker,
  } = useKopilotChatOptions()

  const isStreaming = useKopilotStore((s) => s.isStreaming)
  const activeSessionId = useKopilotStore((s) => s.activeSessionId)
  const activeSessionAgentId = useKopilotStore((s) => s.activeSessionAgentId)
  const addMessage = useKopilotStore((s) => s.addMessage)
  const messages = useKopilotStore((s) => s.messages)
  const editingMessageId = useKopilotStore((s) => s.editingMessageId)
  const setEditingMessage = useKopilotStore((s) => s.setEditingMessage)
  const messageMap = useKopilotStore((s) => s.messageMap)
  const selectedModelId = useKopilotStore((s) => s.selectedModelId)
  const setSelectedModelId = useKopilotStore((s) => s.setSelectedModelId)

  // Sender picker — pre-send selection (post-send, the active session's
  // agentId locks the chip). Master Kopilot only; the agent Chat tab / Build
  // tab opt out via `allowSenderPicker: false`.
  const [selectedAgentActorId, setSelectedAgentActorId] = useState<ActorId | null>(null)
  const [isSenderPickerOpen, setIsSenderPickerOpen] = useState(false)
  const lockedActorId: ActorId | null = activeSessionAgentId
    ? (`agent:${activeSessionAgentId}` as ActorId)
    : null
  const displayActorId: ActorId | null = lockedActorId ?? selectedAgentActorId
  const isSenderLocked = lockedActorId !== null

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

  // Ref to the picker UI so the editor chip's Enter/Arrow handlers can call
  // back into the active list. Wired below via `useReferencePickerEditor`.
  const referencePickerRef = useRef<ReferencePickerHandle | null>(null)

  // Refs so the SenderHotkey extension (constructed once) can read the
  // current open/locked state without re-instantiating the editor.
  const senderHotkeyOpenRef = useRef<() => void>(() => {})
  const senderHotkeyLockedRef = useRef<boolean>(false)
  senderHotkeyLockedRef.current = isSenderLocked
  senderHotkeyOpenRef.current = () => setIsSenderPickerOpen(true)

  const { editor, confirmReference, closePicker } = useReferencePickerEditor({
    placeholder: placeholder ?? 'Ask Kopilot...',
    editable: true,
    enableReferencePicker: allowReferencePicker,
    className: cn('prose prose-sm prose-p:my-0 focus:outline-hidden max-w-none dark:prose-invert'),
    onUpdate: (html) => {
      const empty = isEmptyContent(html)
      setIsEmpty((prev) => (prev === empty ? prev : empty))
    },
    onPickerEnter: () => referencePickerRef.current?.confirmHighlighted() ?? false,
    onPickerArrowVertical: (dir) => referencePickerRef.current?.moveHighlight(dir) ?? false,
    extensions: [
      SubmitOnEnter.configure({
        isExpanded: () => false,
        onSubmit: () => {
          // Don't submit if slash picker is open
          if (slashIsOpenRef.current) return
          handleSendRef.current()
        },
      }),
      ...(allowSlashCommands ? [slashCommandExtension] : []),
      ...(allowSenderPicker
        ? [
            SenderHotkey.configure({
              onTrigger: () => {
                // Locked state: let `#` fall through to normal text input.
                if (senderHotkeyLockedRef.current) return false
                senderHotkeyOpenRef.current()
                return true
              },
            }),
          ]
        : []),
      promptNodeExtension,
    ],
  })

  const activePicker = useActivePicker(editor)

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
      populate: (text: string) => {
        if (!editor) return
        const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        editor.commands.setContent(`<p>${escaped}</p>`)
        editor.commands.focus('end')
      },
    }),
    [editor]
  )

  const handleSend = useCallback(() => {
    if (!editor || isStreaming) return

    // Collapse any open picker chip to plain `@<query>` text so the chip's
    // transient markup never reaches storage / the LLM.
    if (allowReferencePicker) {
      editor.commands.closeReferencePicker({ keepText: true })
    }

    const html = editor.getHTML()
    if (isEmptyContent(html)) return

    // Resolve prompt template badges to full prompt text
    const resolvedHtml = resolvePromptBadges(html, templateMap)

    // Extract `@`-mentioned references from the original HTML before flattening
    const mentionRefs = extractMentionRefs(html)

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

    // Snapshot the merged context at submit time, strip dismissed chips, then
    // reset dismissals so the chip reappears next turn.
    const store = useKopilotStore.getState()
    const surfaceContext = applyChipDismissals(
      selectMergedContext(store.contextSlices),
      store.dismissedChipKeys
    )
    store.clearDismissedChips()
    store.clearPendingChipPrompts()

    // Merge surface refs (page-derived) with editor `@`-mention refs.
    const surfaceRefs = surfaceContext.references ?? []
    const combinedRefs = mentionRefs.length === 0 ? surfaceRefs : [...surfaceRefs, ...mentionRefs]
    const mergedContext = {
      ...surfaceContext,
      ...(combinedRefs.length > 0 ? { references: combinedRefs } : {}),
    }

    // Sender pick — lock takes precedence over in-flight selection. Master
    // Kopilot leaves both null and sends without `agentId` / `triggerKind`.
    const senderAgentId = displayActorId ? parseActorId(displayActorId).id : null

    onSend({
      sessionId: activeSessionId ?? undefined,
      message: text.trim(),
      type: 'message',
      page: surfaceContext.page ?? page,
      context: mergedContext,
      modelId: selectedModelId ?? undefined,
      ...(senderAgentId ? { agentId: senderAgentId, triggerKind: 'dm' as const } : {}),
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
    editingMessageId,
    setEditingMessage,
    messageMap,
    messages,
    templateMap,
    templateDisplayMap,
    selectedModelId,
    allowReferencePicker,
    displayActorId,
  ])

  // Keep ref in sync
  handleSendRef.current = handleSend

  // Populate editor when editing a message
  useEffect(() => {
    if (editingMessageId && editor) {
      const msg = messages.find((m) => m.id === editingMessageId)
      if (msg) {
        editor.commands.setContent(msg.content ?? '')
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
    if (editor.isFocused) {
      editor.commands.insertContent('/')
      return
    }
    // Editor wasn't focused. TipTap's focus() schedules DOM focus via
    // setTimeout(0); inserting "/" synchronously opens the picker before DOM
    // focus lands, and the late focus event then bubbles outside the popover
    // — Radix sees focus leave and closes the picker. Wait one task for DOM
    // focus to settle before inserting.
    editor.commands.focus('end')
    setTimeout(() => editor.commands.insertContent('/'), 0)
  }, [editor])

  return (
    <div ref={containerRef} className={cn('p-3', contentClassName)}>
      <KopilotReplyChipStrip
        onSelect={(label) => {
          if (!editor) return
          editor.commands.setContent(`<p>${label}</p>`)
          handleSendRef.current()
        }}
      />
      <KopilotContextChipStrip />
      <div className='relative flex flex-col rounded-xl border min-h-[120px] bg-primary-150 focus-within:border-info'>
        <div className='relative flex flex-1 flex-col min-h-0'>
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
          {/* Reference picker (@) — tabbed people/records/messages/articles */}
          {allowReferencePicker && (
            <InlinePickerPopover
              state={{
                isOpen: !!activePicker,
                query: activePicker?.query ?? '',
                range: null,
                clientRect: activePicker?.clientRect ?? null,
              }}
              containerRef={containerRef}
              width={360}
              side='top'
              align='start'
              autoFocus={false}
              onInteractOutside={(e) => {
                // Clicking the chip itself must not close the picker — the
                // user is editing the query inline. Without this, Radix sees
                // the click as outside the popover and triggers onClose,
                // collapsing the chip to plain `@<query>` text.
                const target = e.target as HTMLElement | null
                if (target?.closest('[data-type="reference-picker"]')) {
                  e.preventDefault()
                }
              }}
              onClose={() => closePicker({ keepText: true })}>
              <ReferencePickerContent
                ref={referencePickerRef}
                tab={activePicker?.tab ?? 'people'}
                query={activePicker?.query ?? ''}
                onSelect={(id) => confirmReference(id)}
                onTabChange={(tab) => editor?.commands.setReferencePickerTab(tab)}
              />
            </InlinePickerPopover>
          )}
          {/* Slash command picker (/) */}
          {allowSlashCommands && (
            <InlinePickerPopover
              state={slashSuggestionState}
              containerRef={containerRef}
              width={280}
              onClose={slashClosePicker}>
              <PromptTemplatePickerContent
                onClose={slashClosePicker}
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
          )}
        </div>
        <div className='flex items-center justify-between p-1 '>
          <div className='flex items-center gap-0.5 overflow-y-auto no-scrollbar overscroll-contain'>
            {allowModelPicker && (
              <AiModelPicker
                value={selectedModelId ?? systemLlmDefault}
                onChange={handleModelFilter}
                modelTypes={[ModelType.LLM]}
                triggerVariant='transparent'
                triggerClassName='h-7 text-xs text-muted-foreground'
                compact
                skipDeprecated
              />
            )}
            {allowSenderPicker && (
              <SenderPicker
                displayActorId={displayActorId}
                isLocked={isSenderLocked}
                open={isSenderPickerOpen}
                onOpenChange={setIsSenderPickerOpen}
                onSelect={(actorId) => {
                  setSelectedAgentActorId(actorId)
                  setIsSenderPickerOpen(false)
                }}
                onClear={() => setSelectedAgentActorId(null)}
              />
            )}
          </div>
          <div className='flex items-center gap-0.5 shrink-0'>
            {allowSlashCommands && (
              <Tooltip content='Insert prompt template' shortcut='/' allowInteraction>
                <Button
                  size='icon-sm'
                  variant='ghost'
                  className='shrink-0'
                  onMouseDown={(e) => {
                    // Prevent editor blur — keeps the Suggestion plugin state
                    // alive so inserting "/" opens the picker.
                    e.preventDefault()
                    handleInsertSlash()
                  }}
                  disabled={isStreaming}
                  title='Insert prompt template'>
                  <SquareSlash />
                </Button>
              </Tooltip>
            )}
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

// ── Sender picker ──────────────────────────────────────────────────────────

interface SenderPickerProps {
  displayActorId: ActorId | null
  isLocked: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (actorId: ActorId) => void
  onClear: () => void
}

/**
 * "Who's responding" chip + popover. Lives in the composer's bottom-left
 * cluster next to the model picker. Master Kopilot is the default state
 * (no selection — no chip clear); selecting an agent flips outgoing
 * requests to `triggerKind: 'dm'` and binds the new session to that agent.
 *
 * Locked state: once the active session has an `agentId`, the chip
 * renders read-only — the responder is pinned for the rest of the
 * thread. The "Start new chat" affordance lands later.
 */
function SenderPicker({
  displayActorId,
  isLocked,
  open,
  onOpenChange,
  onSelect,
  onClear,
}: SenderPickerProps) {
  // Resolve the selected agent's display name + avatar from the actor store.
  // Skipped entirely when nothing is picked — the null state renders a
  // hardcoded "Kopilot" + bot icon (no fetch).
  const { actor } = useActor({ actorId: displayActorId, enabled: !!displayActorId })

  const label = displayActorId ? (actor?.name ?? 'Loading…') : 'Kopilot'
  const avatarUrl = displayActorId ? actor?.avatarUrl : null

  const chipBody = (
    <span className='flex items-center gap-1.5'>
      {avatarUrl ? (
        <Avatar className='size-4'>
          <AvatarImage src={avatarUrl} alt={label} />
          <AvatarFallback className='text-[10px]'>{label.slice(0, 1)}</AvatarFallback>
        </Avatar>
      ) : (
        <Bot className='size-3.5 opacity-70' />
      )}
      <span className='truncate max-w-[120px]'>{label}</span>
    </span>
  )

  if (isLocked) {
    // Post-send / hydrated lock — no chevron, no X, no popover.
    return (
      <div
        className='flex items-center gap-1 h-7 px-2 text-xs text-muted-foreground opacity-70 pointer-events-none rounded-md'
        aria-label={`Responding as ${label}`}>
        {chipBody}
      </div>
    )
  }

  const showClear = displayActorId !== null

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant='ghost'
          size='sm'
          className='h-7 px-2 text-xs text-muted-foreground gap-1'
          aria-label='Pick who responds'>
          {chipBody}
          {showClear ? (
            <span
              role='button'
              tabIndex={-1}
              className='ml-0.5 inline-flex items-center justify-center rounded hover:bg-primary-200/70 p-0.5'
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onClear()
              }}
              aria-label='Clear sender — return to Kopilot'>
              <X className='size-3' />
            </span>
          ) : (
            <ChevronsUpDown className='size-3 opacity-50' />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='p-0 w-72' align='start' side='top'>
        <ActorPickerContent
          target='agent'
          multi={false}
          value={displayActorId ? [displayActorId] : []}
          onChange={() => {
            // Single-select path is handled by onSelectSingle.
          }}
          onSelectSingle={(actorId) => onSelect(actorId)}
        />
      </PopoverContent>
    </Popover>
  )
}
