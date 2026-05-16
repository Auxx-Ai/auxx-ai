// apps/web/src/components/global/comments/comment-content.tsx
'use client'

import { EditorContent, type JSONContent } from '@tiptap/react'
import { useEffect } from 'react'
import { useReferenceEditor } from '~/components/editor/inline-picker'

interface CommentContentProps {
  doc: JSONContent | null | undefined
}

/**
 * Read-only Tiptap render of a comment's `contentJson`. Mounts the same
 * inline-picker reference extension as the composer so badge rendering
 * (ActorBadge / RecordBadge / ThreadBadge) is identical.
 *
 * Pre-launch — no production users — so legacy HTML rows don't exist; the
 * input is always a Tiptap JSON doc.
 */
export function CommentContent({ doc }: CommentContentProps) {
  const { editor } = useReferenceEditor({
    initialContent: '',
    editable: false,
    className:
      'prose prose-sm prose-headings:my-1 prose-ul:my-1 prose-p:my-0 prose-li:my-0 max-w-none focus:outline-hidden dark:prose-invert',
  })

  useEffect(() => {
    if (!editor) return
    if (doc) {
      editor.commands.setContent(doc as JSONContent)
    } else {
      editor.commands.clearContent()
    }
  }, [editor, doc])

  return <EditorContent editor={editor} />
}
