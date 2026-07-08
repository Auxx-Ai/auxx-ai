// apps/web/src/components/dashboard/ui/widget/rich-text-widget.tsx
'use client'

// Rich-text (note) widget. Runs the shared prompt/KB block editor
// (`PromptEditorContent` over `useRichTextEditor`) in PLAIN_PROSE mode: the `/`
// slash menu (text / headings / lists / to-do / quote / divider / code) plus the
// selection bubble menu, but NO `@` references (`enableMention={false}`). The doc
// is stored as TipTap block JSON in `config.content` (matches `RichTextConfig`).
// No realtime collab, so none of the seed-once/remount machinery is needed. Edits
// debounce (~500ms) before writing back so we don't dirty the draft per keypress.

import type { RichTextConfig } from '@auxx/lib/dashboards/client'
import { cn } from '@auxx/ui/lib/utils'
import type { JSONContent } from '@tiptap/core'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { PLAIN_PROSE } from '~/components/editor/blocks/allowed-blocks'
import { PromptEditorContent } from '~/components/editor/prompt-editor'

const DEBOUNCE_MS = 500

// Stable no-ops — the note widget has no header widgets (char count / copy) and
// no focus-driven chrome, so it ignores editor-ready / focus events. Module-scope
// so they don't defeat `PromptEditorContent`'s `memo` on every widget re-render.
const noop = () => {}

/** Read the stored block array off the saved doc (`{type:'doc', content:[…]}`). */
function readContent(content: unknown): JSONContent[] | null {
  const nodes = (content as { content?: unknown } | null)?.content
  return Array.isArray(nodes) ? (nodes as JSONContent[]) : null
}

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

  // Read once — `PromptEditorContent` snapshots `initialContent` on mount and
  // owns the doc thereafter (edits flow out through `onChange`).
  const initialContent = useMemo(() => readContent(config.content), [config.content])

  const handleChange = useCallback(
    ({ json }: { json: JSONContent }) => {
      if (!onChange) return
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => onChange(json), DEBOUNCE_MS)
    },
    [onChange]
  )

  // Flush a pending debounce on unmount so the last edit isn't lost.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return (
    // View mode hides the card header (the note reads as a plain note), which
    // removes the top gap the header row otherwise gives it — add a little back.
    <div className={cn('flex-1 min-h-0 overflow-y-auto', !isEditMode && 'pt-2')}>
      <PromptEditorContent
        initialContent={initialContent}
        onChange={handleChange}
        onEditorReady={noop}
        onFocusChange={noop}
        editable={isEditMode}
        allowedBlocks={PLAIN_PROSE}
        enableMention={false}
        placeholderText="Write something, or press '/' for commands"
      />
    </div>
  )
}
