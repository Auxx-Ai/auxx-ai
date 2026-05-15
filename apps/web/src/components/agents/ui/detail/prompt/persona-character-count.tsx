// apps/web/src/components/agents/ui/detail/prompt/persona-character-count.tsx
'use client'

import type { Editor } from '@tiptap/react'
import { useEffect, useRef } from 'react'

interface PersonaCharacterCountProps {
  editor: Editor | null
}

/**
 * Renders the persona doc's plain-text character count without forcing the
 * surrounding `PersonaEditor` to re-render per keystroke. Subscribes to the
 * editor's `update` event and writes directly to its own DOM node — React
 * never sees the count change, so the parent's render tree (header,
 * `EditorContent`, picker popovers) stays mounted untouched while typing.
 */
export function PersonaCharacterCount({ editor }: PersonaCharacterCountProps) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!editor) return
    const el = ref.current
    if (!el) return
    const update = () => {
      el.textContent = String(editor.getText().length)
    }
    update()
    editor.on('update', update)
    editor.on('create', update)
    return () => {
      editor.off('update', update)
      editor.off('create', update)
    }
  }, [editor])

  return (
    <span ref={ref} className='text-xs font-medium leading-[18px] text-primary-500'>
      0
    </span>
  )
}
