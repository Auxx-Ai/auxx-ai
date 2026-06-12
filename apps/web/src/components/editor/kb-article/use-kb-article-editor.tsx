// apps/web/src/components/editor/kb-article/use-kb-article-editor.tsx
'use client'

import type { JSONContent } from '@tiptap/core'
import { useRichTextEditor } from '../rich-text/use-rich-text-editor'

interface UseKBArticleEditorOptions {
  initialContent: JSONContent[] | null
  /** `html` is a lazy getter — see `UseRichTextEditorOptions.onChange`. */
  onChange: (content: { json: JSONContent; getHTML: () => string }) => void
  /** Forwarded to the inline `@`-mention picker chip — typically delegates to the popover's keyboard handle. */
  onPickerEnter?: () => boolean
  onPickerArrowVertical?: (direction: 1 | -1) => boolean
  /** Forwarded to the `/` command picker chip — delegates to `KBSlashContent`'s handle. */
  onSlashEnter?: () => boolean
  onSlashArrowVertical?: (direction: 1 | -1) => boolean
  onSlashBackspacePop?: () => boolean
  onSlashArrowRight?: () => boolean
}

/**
 * Thin shim over `useRichTextEditor` that enables the `/` command chip for
 * the KB article surface. Both pickers (`@` and `/`) ride the same chip
 * node; the consumer mounts the popovers via `useActivePicker(editor)`.
 */
export function useKBArticleEditor({
  initialContent,
  onChange,
  onPickerEnter,
  onPickerArrowVertical,
  onSlashEnter,
  onSlashArrowVertical,
  onSlashBackspacePop,
  onSlashArrowRight,
}: UseKBArticleEditorOptions) {
  const { editor, gutterCharWidth } = useRichTextEditor({
    initialContent,
    onChange,
    slash: true,
    onSlashEnter,
    onSlashArrowVertical,
    onSlashBackspacePop,
    onSlashArrowRight,
    enableReferencePicker: true,
    onPickerEnter,
    onPickerArrowVertical,
  })

  return { editor, gutterCharWidth }
}
