// apps/web/src/components/agents/ui/detail/prompt/persona-editor.tsx
'use client'

import type { JSONContent } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { useCallback, useMemo, useRef } from 'react'
import { InlinePickerPopover, useActivePicker } from '~/components/editor/inline-picker'
import { useRichTextEditor } from '~/components/editor/rich-text/use-rich-text-editor'
import {
  ReferencePickerContent,
  type ReferencePickerHandle,
} from '~/components/pickers/reference-picker/reference-picker-content'
import { useAgentAutosave } from '../../../hooks/use-agent-autosave'
import type { AgentDetail } from '../../../store/agent-store'
import type { AutosaveState } from '../../shared/autosave-indicator'

interface PersonaEditorProps {
  agent: AgentDetail
  /** Lifted autosave state — used by the page-header indicator. */
  onAutosaveChange?: (state: AutosaveState) => void
}

function readPromptContent(
  prompt: Record<string, unknown> | null | undefined
): JSONContent[] | null {
  if (!prompt) return null
  const content = (prompt as { content?: unknown }).content
  if (!Array.isArray(content)) return null
  return content as JSONContent[]
}

/**
 * Persona prompt editor for the agent detail page. Mounts `useRichTextEditor`
 * with the inline `@`-mention picker so admins can drop references to records,
 * actors, threads, and KB articles inline in the persona doc.
 */
export function PersonaEditor({ agent, onAutosaveChange }: PersonaEditorProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const referencePickerRef = useRef<ReferencePickerHandle | null>(null)
  const { patch } = useAgentAutosave(agent.id, { onStateChange: onAutosaveChange })

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

  return (
    <div ref={wrapperRef} className='relative'>
      <EditorContent
        editor={editor}
        className='prose prose-sm max-w-none dark:prose-invert focus:outline-none'
      />
      <InlinePickerPopover
        state={{
          isOpen: !!activePicker,
          query: activePicker?.query ?? '',
          range: null,
          clientRect: activePicker?.clientRect ?? null,
        }}
        containerRef={wrapperRef}
        width={360}
        side='bottom'
        align='start'
        autoFocus={false}
        onInteractOutside={(e) => {
          // Clicking the chip itself must not close the picker.
          const target = e.target as HTMLElement | null
          if (target?.closest('[data-type="reference-picker"]')) {
            e.preventDefault()
          }
        }}
        onClose={() => editor?.commands.closeReferencePicker({ keepText: true })}>
        <ReferencePickerContent
          ref={referencePickerRef}
          tab={activePicker?.tab ?? 'people'}
          query={activePicker?.query ?? ''}
          onSelect={(id) => editor?.commands.confirmReferencePicker(id)}
          onTabChange={(tab) => editor?.commands.setReferencePickerTab(tab)}
        />
      </InlinePickerPopover>
    </div>
  )
}
