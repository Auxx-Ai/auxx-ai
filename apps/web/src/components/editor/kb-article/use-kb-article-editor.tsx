// apps/web/src/components/editor/kb-article/use-kb-article-editor.ts
'use client'

import type { JSONContent } from '@tiptap/core'
import { useSlashCommand } from '../inline-picker'
import { useRichTextEditor } from '../rich-text/use-rich-text-editor'

interface UseKBArticleEditorOptions {
  initialContent: JSONContent[] | null
  /** `html` is a lazy getter — see `UseRichTextEditorOptions.onChange`. */
  onChange: (content: { json: JSONContent; getHTML: () => string }) => void
  /** Forwarded to the inline `@`-mention picker chip — typically delegates to the popover's keyboard handle. */
  onPickerEnter?: () => boolean
  onPickerArrowVertical?: (direction: 1 | -1) => boolean
}

/**
 * Thin shim over `useRichTextEditor` that wires the KB-specific slash
 * command picker and exposes its state for the consumer to mount the
 * picker popover. The `@`-mention picker is enabled by default; the
 * consumer mounts that popover via `useActivePicker(editor)`.
 */
export function useKBArticleEditor({
  initialContent,
  onChange,
  onPickerEnter,
  onPickerArrowVertical,
}: UseKBArticleEditorOptions) {
  const slashCommand = useSlashCommand()

  const { editor, gutterCharWidth } = useRichTextEditor({
    initialContent,
    onChange,
    slashCommand,
    enableReferencePicker: true,
    onPickerEnter,
    onPickerArrowVertical,
  })

  return { editor, gutterCharWidth, slashCommand }
}
