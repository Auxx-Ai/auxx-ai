// apps/web/src/components/editor/prompt-editor/prompt-editor.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { useCallback, useRef, useState } from 'react'
import type { ReferenceTab } from '~/components/editor/inline-picker/nodes/reference-picker-node'
import type { ReferencePickerHandle } from '~/components/pickers/reference-picker/reference-picker-content'
import { PromptEditorContent } from './prompt-editor-content'

export interface PromptEditorProps {
  /** Snapshot read on mount. Subsequent identity changes do NOT re-init the editor. */
  initialContent: JSONContent[] | null
  onChange: (content: { json: JSONContent; html: string }) => void
  /**
   * Reference-picker tabs the editor exposes. Defaults to `DEFAULT_TABS`;
   * pass `[...DEFAULT_TABS, 'tools', 'resources', 'fields']` for the
   * admin-only set (persona / template authoring).
   */
  referenceTabs?: ReferenceTab[]
  /** Surfaces the underlying editor instance — used for character count, copy, etc. */
  onEditorReady?: (editor: Editor | null) => void
  /** Fires on TipTap focus/blur. */
  onFocusChange?: (focused: boolean) => void
  className?: string
  /**
   * When `false`, renders the prompt with the same TipTap extensions
   * (badges, blocks) but disables typing — for read-only previews like
   * the template gallery detail view.
   */
  editable?: boolean
}

/**
 * Bare prompt editor — mounts a single `PromptEditorContent` (TipTap)
 * instance with no card chrome, header, autosave, or expand-to-dialog.
 *
 * For the agent persona surface that needs all of that, see
 * `agents/ui/detail/prompt/persona-editor.tsx` — it mounts
 * `PromptEditorContent` directly and adds its own card/dialog
 * orchestration (the two-instance handoff pattern doesn't generalize).
 *
 * The template dialogs (`prompt-form-dialog`, `prompt-template-dialog`)
 * use this wrapper because they live inside a Dialog that already
 * supplies framing.
 */
export function PromptEditor({
  initialContent,
  onChange,
  referenceTabs,
  onEditorReady,
  onFocusChange,
  className,
  editable = true,
}: PromptEditorProps) {
  const referencePickerRef = useRef<ReferencePickerHandle | null>(null)
  const [, setFocused] = useState(false)

  const handleFocusChange = useCallback(
    (focused: boolean) => {
      setFocused(focused)
      onFocusChange?.(focused)
    },
    [onFocusChange]
  )

  const handleEditorReady = useCallback(
    (editor: Editor | null) => {
      onEditorReady?.(editor)
    },
    [onEditorReady]
  )

  return (
    <div className={cn('relative flex w-full', className)}>
      <PromptEditorContent
        initialContent={initialContent}
        onChange={onChange}
        onEditorReady={handleEditorReady}
        onFocusChange={handleFocusChange}
        referencePickerRef={referencePickerRef}
        referenceTabs={referenceTabs}
        editable={editable}
      />
    </div>
  )
}
