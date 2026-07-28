// apps/web/src/components/agents/ui/detail/prompt/persona-editor.tsx
'use client'

import { Dialog, DialogContent, DialogTitle } from '@auxx/ui/components/dialog'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { VisuallyHidden } from '@auxx/ui/components/visually-hidden'
import { cn } from '@auxx/ui/lib/utils'
import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PERSONA_BLOCKS } from '~/components/editor/blocks/allowed-blocks'
import { DEFAULT_TABS } from '~/components/editor/inline-picker'
import type { ReferenceTab } from '~/components/editor/inline-picker/nodes/reference-picker-node'
import {
  PromptCharacterCount,
  PromptEditorContent,
  PromptEditorHeader,
} from '~/components/editor/prompt-editor'
import type { ReferencePickerHandle } from '~/components/pickers/reference-picker/reference-picker-content'
import CollapseWrap from '~/components/workflow/ui/collapse-wrap'
import { api } from '~/trpc/react'
import { useAgentAutosave } from '../../../hooks/use-agent-autosave'
import type { AgentDetail } from '../../../store/agent-store'
import type { AutosaveState } from '../../shared/autosave-indicator'

interface PersonaEditorProps {
  agent: AgentDetail
  /**
   * The viewer holds `view` but not `edit` on this agent (plan 25 §4.2). The
   * prompt is still shown — `view` is *usable*, and reading the persona is part
   * of knowing what you are chatting with — but TipTap mounts non-editable, so
   * no autosave can fire.
   */
  readOnly?: boolean
  /** Lifted autosave state — used by the page-header indicator. */
  onAutosaveChange?: (state: AutosaveState) => void
}

const COLLAPSED_MIN_HEIGHT = 120

// Persona editor opts into the admin-only tabs (Tools, Resources, Fields) —
// admins reference toolsets they want pinned, and schema objects (entities /
// fields) so the builder can chip status/priority/category values instead of
// ad-libbing prose. Customer-facing editors (mail composer, KB articles)
// stay on `DEFAULT_TABS` by design.
const PERSONA_REFERENCE_TABS: ReferenceTab[] = [...DEFAULT_TABS, 'tools', 'resources', 'fields']

function readPromptContent(
  prompt: Record<string, unknown> | null | undefined
): JSONContent[] | null {
  if (!prompt) return null
  const content = (prompt as { content?: unknown }).content
  if (!Array.isArray(content)) return null
  return content as JSONContent[]
}

/**
 * Persona prompt editor for the agent detail page. Visual structure mirrors
 * the workflow `PromptEditor` (focus-gradient border, header with copy +
 * expand actions, resizable content, expand-to-dialog).
 *
 * Two-editor pattern: the card and the expanded dialog each mount their own
 * `PromptEditorContent` (with its own `useRichTextEditor` call). Only one
 * is mounted at a time — toggling `isExpanded` unmounts one and mounts the
 * other. `currentDocRef` holds the live document so the next editor inits
 * from where the previous left off (the autosave debounce window is too
 * long to rely on `agent.prompt` for cross-mount handoff).
 *
 * A single editor instance does not work here — TipTap's `EditorContent`
 * runs `flushSync` in `componentDidMount`, which React re-fires whenever
 * the subtree's host changes (portal target swap or simple reparenting),
 * leaving the view DOM in a broken state.
 */
export function PersonaEditor({ agent, readOnly, onAutosaveChange }: PersonaEditorProps) {
  const referencePickerRef = useRef<ReferencePickerHandle | null>(null)
  const { patch } = useAgentAutosave(agent.id, { onStateChange: onAutosaveChange })
  const utils = api.useUtils()

  // Warm the org-wide tool catalog so the client-side mention reconciler
  // (in `useAgentMutations`) has it on hand the very first time a user
  // types a `tool:<name>` chip. The ReferencePicker prefetches on its own,
  // but only after the user opens the Tools tab — too late to make the
  // first chip's Lock badge appear synchronously.
  useEffect(() => {
    void utils.agentToolset.listTools.prefetch()
  }, [utils.agentToolset.listTools])

  const [isExpanded, setExpanded] = useState(false)
  const [isFocused, setFocused] = useState(false)
  const [isCollapsed, setCollapsed] = useState(true)
  const [isCopied, setIsCopied] = useState(false)

  // The doc each child editor reads on mount. We keep it in a ref so live
  // edits don't cause `PromptEditorContent` to re-render with a new prop
  // (TipTap's `useEditor` reads `initialContent` once, but changing the
  // prop identity would still re-render the wrapper unnecessarily).
  const initialContent = useMemo(() => readPromptContent(agent.prompt), [agent.prompt])
  const currentDocRef = useRef<JSONContent[] | null>(initialContent)

  const [activeEditor, setActiveEditor] = useState<Editor | null>(null)

  const handleChange = useCallback(
    ({ json }: { json: JSONContent; getHTML: () => string }) => {
      const content = Array.isArray(json.content) ? (json.content as JSONContent[]) : null
      currentDocRef.current = content
      // 1500ms matches the KB article editor's autosave window. Pairs with
      // the prompt-only fast path in `useAgentMutations.updateAgent` that
      // splices the cache instead of invalidating, so each flush is cheap.
      patch({ prompt: json as Record<string, unknown> }, { debounceMs: 1500 })
    },
    [patch]
  )

  const handleEditorReady = useCallback((editor: Editor | null) => {
    setActiveEditor(editor)
  }, [])

  const handleUserActivity = useCallback(() => {
    setCollapsed(false)
  }, [])

  const handleCopy = useCallback(() => {
    if (!activeEditor) return
    const text = activeEditor.getText()
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
    }
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }, [activeEditor])

  // Stable element so the memoized header doesn't see a new `countSlot`
  // prop every time PersonaEditor re-renders (focus/blur, autosave state).
  const countSlot = useMemo(() => <PromptCharacterCount editor={activeEditor} />, [activeEditor])

  const header = (
    <PromptEditorHeader
      title='Persona'
      countSlot={countSlot}
      isExpanded={isExpanded}
      setExpanded={setExpanded}
      isCopied={isCopied}
      onCopy={handleCopy}
    />
  )

  return (
    <>
      <div
        className={cn(
          'me-1',
          isFocused && !isExpanded
            ? 'bg-gradient-to-r from-[#0ba5ec] to-[#155aef]'
            : 'bg-transparent',
          '!rounded-[9px] p-0.5'
        )}>
        <div className={cn(isFocused ? 'bg-background' : 'bg-primary-200/30', 'rounded-lg border')}>
          {header}
          {!isExpanded && (
            <CollapseWrap
              minHeight={COLLAPSED_MIN_HEIGHT}
              isCollapsed={isCollapsed}
              onCollapsedChange={setCollapsed}
              className='px-3'
              gradientClassName='from-primary-200/30 dark:from-primary-200/30'>
              <div className='relative flex w-full'>
                <PromptEditorContent
                  initialContent={currentDocRef.current}
                  onChange={handleChange}
                  onEditorReady={handleEditorReady}
                  onFocusChange={setFocused}
                  onUserActivity={handleUserActivity}
                  referencePickerRef={referencePickerRef}
                  referenceTabs={PERSONA_REFERENCE_TABS}
                  allowedBlocks={PERSONA_BLOCKS}
                  editable={!readOnly}
                />
              </div>
            </CollapseWrap>
          )}
        </div>
      </div>

      <Dialog open={isExpanded} onOpenChange={setExpanded}>
        <DialogContent size='3xl' innerClassName='h-[80vh] flex flex-col p-0' showClose={false}>
          <VisuallyHidden>
            <DialogTitle>Persona</DialogTitle>
          </VisuallyHidden>
          <div className='shrink-0 border-b'>{header}</div>
          <div className='flex-1 min-h-0 overflow-hidden'>
            <ScrollArea
              className='relative h-full min-h-0 px-3 flex-1 flex'
              fadeClassName=''
              allowScrollChaining
              scrollbarClassName='w-1 mr-0.5 data-[hovering]:opacity-0 hover:!opacity-100'>
              {isExpanded && (
                <PromptEditorContent
                  initialContent={currentDocRef.current}
                  onChange={handleChange}
                  onEditorReady={handleEditorReady}
                  onFocusChange={setFocused}
                  onUserActivity={handleUserActivity}
                  referencePickerRef={referencePickerRef}
                  referenceTabs={PERSONA_REFERENCE_TABS}
                  allowedBlocks={PERSONA_BLOCKS}
                  editable={!readOnly}
                />
              )}
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
