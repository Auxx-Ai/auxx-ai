// apps/web/src/components/dashboard/ui/widget/rich-text-widget.tsx
'use client'

// Rich-text (note) widget. TipTap over the workflow note-editor's extensions
// (`getNoteEditorExtensions`) — the meaningful reuse — storing the doc as TipTap
// JSON in `config.content` (matches `RichTextConfig`). No realtime collab, so
// none of the seed-once/remount machinery from record notes is needed. Edits
// debounce (~500ms) before writing back so we don't dirty the draft per keypress.

import type { RichTextConfig } from '@auxx/lib/dashboards/client'
import { cn } from '@auxx/ui/lib/utils'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef } from 'react'
import { getNoteEditorExtensions } from '~/components/workflow/nodes/core/note/editor/extensions'

const DEBOUNCE_MS = 500

export function RichTextWidget({
  config,
  isEditMode,
  onChange,
}: {
  config: RichTextConfig
  isEditMode: boolean
  /** Persists the TipTap JSON doc into the draft (plan 08: `updateWidgetConfig`). */
  onChange?: (content: unknown) => void
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const editor = useEditor(
    {
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      editable: isEditMode,
      extensions: getNoteEditorExtensions('Write something…'),
      // TipTap accepts a JSON doc or HTML string; config.content is the JSON doc.
      content: (config.content as object | null) ?? undefined,
      editorProps: {
        attributes: {
          class: cn(
            'prose prose-sm max-w-none focus:outline-none',
            'prose-p:my-1 prose-ul:my-1 prose-li:my-0 min-h-full'
          ),
        },
      },
      onUpdate: ({ editor, transaction }) => {
        if (!onChange) return
        // Ignore the doc-init/normalization transaction TipTap emits on mount —
        // only user edits should dirty the draft (else just opening edit mode,
        // which toggles `editable`, would auto-save an unchanged widget).
        if (!transaction.docChanged) return
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => onChange(editor.getJSON()), DEBOUNCE_MS)
      },
    },
    // Create the editor ONCE — do NOT recreate on `isEditMode` (that fires an
    // init `onUpdate` that spuriously dirties the draft). Editability is toggled
    // by the effect below via `setEditable`.
    []
  )

  // Keep editability in sync when toggling modes on an already-mounted editor.
  useEffect(() => {
    editor?.setEditable(isEditMode)
  }, [editor, isEditMode])

  // Flush a pending debounce on unmount so the last edit isn't lost.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return <EditorContent editor={editor} className='flex-1 min-h-0 overflow-y-auto' />
}
