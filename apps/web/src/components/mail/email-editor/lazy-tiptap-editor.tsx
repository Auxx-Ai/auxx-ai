// apps/web/src/components/mail/email-editor/lazy-tiptap-editor.tsx
'use client'

import { Loader2 } from 'lucide-react'
import React, { Suspense } from 'react'

const TiptapEditor = React.lazy(() => import('~/components/editor/tiptap-editor'))

interface LazyTiptapEditorProps {
  content: string
  onChange: (html: string) => void
  placeholder?: string
  editable?: boolean
  className?: string
  popoverClassName?: string
}

/**
 * Placeholder shown while TiptapEditor loads.
 * Matches the editor's min-height to prevent layout shift.
 */
function EditorPlaceholder() {
  return (
    <div className='flex items-center justify-center min-h-[120px] px-4 py-3'>
      <Loader2 className='size-5 animate-spin text-muted-foreground' />
    </div>
  )
}

/**
 * Lazy-loaded TiptapEditor with Suspense boundary.
 * Defers heavy ProseMirror initialization until after initial render.
 */
export function LazyTiptapEditor(props: LazyTiptapEditorProps) {
  return (
    <Suspense fallback={<EditorPlaceholder />}>
      <TiptapEditor {...props} />
    </Suspense>
  )
}
