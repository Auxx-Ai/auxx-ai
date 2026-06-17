// apps/web/src/components/mail/email-editor/lazy-tiptap-editor.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import type { JSONContent } from '@tiptap/core'
import { Loader2 } from 'lucide-react'
import React, { Suspense } from 'react'
import type { FileItem } from '~/components/files/files-store'
import type { MailAiSlashConfig, MailReferenceConfig } from './mail-slash-content'

const TiptapEditor = React.lazy(() => import('~/components/editor/tiptap-editor'))

interface LazyTiptapEditorProps {
  content: JSONContent
  onChange: (json: JSONContent) => void
  placeholder?: string
  editable?: boolean
  className?: string
  /** Extra class applied to the outer EditorContent wrapper (and matched on the loading placeholder so min-height stays in sync). */
  contentClassName?: string
  popoverClassName?: string
  /** When provided, plain Enter (no shift/cmd/ctrl) calls this instead of inserting a paragraph break. */
  onEnter?: () => void
  /** Optional AI-tools wiring — surfaces the "Ask AI" item in the `/` menu. */
  aiSlash?: MailAiSlashConfig
  /** Optional attachment wiring — surfaces the "Attach file" item in the `/` menu. */
  onAttachFile?: (file: FileItem) => void
  /** Optional signature/action wiring — registers the `@` menu (email only). */
  references?: MailReferenceConfig
  /** Formatting profile. `'rich'` (default, email) or `'plain'` (chat). */
  variant?: 'rich' | 'plain'
}

/**
 * Placeholder shown while TiptapEditor loads.
 * Matches the editor's min-height to prevent layout shift.
 */
function EditorPlaceholder({ contentClassName }: { contentClassName?: string }) {
  return (
    <div
      className={cn('flex items-center justify-center min-h-[120px] px-4 py-3', contentClassName)}>
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
    <Suspense fallback={<EditorPlaceholder contentClassName={props.contentClassName} />}>
      <TiptapEditor {...props} />
    </Suspense>
  )
}
