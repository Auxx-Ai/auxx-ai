// apps/web/src/components/agents/ui/detail/prompt/persona-editor.tsx
'use client'

import { Dialog, DialogContent, DialogTitle } from '@auxx/ui/components/dialog'
import { VisuallyHidden } from '@auxx/ui/components/visually-hidden'
import { cn } from '@auxx/ui/lib/utils'
import type { JSONContent } from '@tiptap/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useActivePicker } from '~/components/editor/inline-picker'
import { useRichTextEditor } from '~/components/editor/rich-text/use-rich-text-editor'
import type { ReferencePickerHandle } from '~/components/pickers/reference-picker/reference-picker-content'
import { useAgentAutosave } from '../../../hooks/use-agent-autosave'
import type { AgentDetail } from '../../../store/agent-store'
import type { AutosaveState } from '../../shared/autosave-indicator'
import { PersonaEditorContent } from './persona-editor-content'
import { PersonaEditorHeader } from './persona-editor-header'

interface PersonaEditorProps {
  agent: AgentDetail
  /** Lifted autosave state — used by the page-header indicator. */
  onAutosaveChange?: (state: AutosaveState) => void
}

const MIN_HEIGHT = 240

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
 * expand actions, resizable content, expand-to-dialog). Mounts
 * `useRichTextEditor` with the inline `@`-mention picker so admins can drop
 * references to records, actors, threads, and KB articles inline in the
 * persona doc.
 */
export function PersonaEditor({ agent, onAutosaveChange }: PersonaEditorProps) {
  const referencePickerRef = useRef<ReferencePickerHandle | null>(null)
  const { patch } = useAgentAutosave(agent.id, { onStateChange: onAutosaveChange })

  const [isExpanded, setExpanded] = useState(false)
  const [isFocused, setFocused] = useState(false)
  const [contentHeight, setContentHeight] = useState(MIN_HEIGHT)
  const [characterCount, setCharacterCount] = useState(0)
  const [isCopied, setIsCopied] = useState(false)

  const initialContent = useMemo(() => readPromptContent(agent.prompt), [agent.prompt])

  const onPickerEnter = useCallback(
    () => referencePickerRef.current?.confirmHighlighted() ?? false,
    []
  )
  const onPickerArrowVertical = useCallback(
    (dir: 1 | -1) => referencePickerRef.current?.moveHighlight(dir) ?? false,
    []
  )

  const handleChange = useCallback(
    ({ json }: { json: JSONContent; html: string }) => {
      patch({ prompt: json as Record<string, unknown> }, { debounceMs: 800 })
    },
    [patch]
  )

  const { editor } = useRichTextEditor({
    initialContent,
    onChange: handleChange,
    enableReferencePicker: true,
    onPickerEnter,
    onPickerArrowVertical,
  })

  const activePicker = useActivePicker(editor)

  useEffect(() => {
    if (!editor) return
    const update = () => setCharacterCount(editor.getText().length)
    update()
    editor.on('update', update)
    editor.on('create', update)
    return () => {
      editor.off('update', update)
      editor.off('create', update)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const onFocusEvt = () => setFocused(true)
    const onBlurEvt = () => setFocused(false)
    editor.on('focus', onFocusEvt)
    editor.on('blur', onBlurEvt)
    return () => {
      editor.off('focus', onFocusEvt)
      editor.off('blur', onBlurEvt)
    }
  }, [editor])

  const handleCopy = useCallback(() => {
    if (!editor) return
    const text = editor.getText()
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
    }
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }, [editor])

  const header = (
    <PersonaEditorHeader
      title='Persona'
      characterCount={characterCount}
      isExpanded={isExpanded}
      setExpanded={setExpanded}
      isCopied={isCopied}
      onCopy={handleCopy}
    />
  )

  const content = (
    <PersonaEditorContent
      editor={editor}
      isExpanded={isExpanded}
      contentHeight={contentHeight}
      setContentHeight={setContentHeight}
      minHeight={MIN_HEIGHT}
      activePicker={activePicker}
      referencePickerRef={referencePickerRef}
    />
  )

  return (
    <>
      <div
        className={cn(
          isFocused ? 'bg-gradient-to-r from-[#0ba5ec] to-[#155aef]' : 'bg-transparent',
          '!rounded-[9px] p-0.5 w-full'
        )}>
        <div
          className={cn(
            isFocused ? 'bg-background' : 'bg-primary-200/30',
            'pb-2 rounded-lg border'
          )}>
          {header}
          {!isExpanded && content}
        </div>
      </div>

      <Dialog open={isExpanded} onOpenChange={setExpanded}>
        <DialogContent size='3xl' innerClassName='h-[80vh] flex flex-col p-0' showClose={false}>
          <VisuallyHidden>
            <DialogTitle>Persona</DialogTitle>
          </VisuallyHidden>
          <div className='shrink-0 border-b'>{header}</div>
          <div className='flex-1 min-h-0 overflow-hidden'>{content}</div>
        </DialogContent>
      </Dialog>
    </>
  )
}
