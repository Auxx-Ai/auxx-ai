// apps/web/src/components/signatures/ui/signature-body-editor.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { type Editor, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import '~/styles/prosemirror.css'
import { useEditorContext } from '~/components/editor/editor-context'
import { FontSize } from '~/components/editor/extensions'
import { Indent } from '~/components/editor/extensions/indent'
import { useExternalContentSync } from '~/components/editor/inline-picker'

interface SignatureBodyEditorProps {
  /** Signature body as an HTML string (the persisted, send-time format). */
  content: string
  onChange: (html: string) => void
  placeholder?: string
  className?: string
  contentClassName?: string
  editable?: boolean
}

/**
 * Plain rich-text editor for signature bodies. StarterKit + font/size/color/
 * align, HTML in / HTML out — signatures are stored as HTML and concatenated
 * at send time. Deliberately has NO slash / chip picker (unlike the mail
 * composer's `tiptap-editor`, which is JSON-canonical and `/`-driven).
 */
export function SignatureBodyEditor({
  content,
  onChange,
  placeholder = 'Design your signature here...',
  className = '',
  contentClassName,
  editable = true,
}: SignatureBodyEditorProps) {
  const { setEditor } = useEditorContext()
  const externalSyncRef = useRef<{ markLocalEdit: (key: string) => void }>({
    markLocalEdit: () => {},
  })

  const extensions = useMemo(
    () => [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Indent,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder }),
    ],
    [placeholder]
  )

  const editorInstance = useEditor(
    {
      extensions,
      content,
      shouldRerenderOnTransaction: false,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: cn(
            'tiptap-email-editor prose prose-sm prose-headings:my-1 prose-ul:my-1 prose-p:my-0 prose-li:my-0 focus:outline-hidden max-w-none dark:prose-invert flex-1',
            className
          ),
        },
      },
      onCreate: ({ editor }) => setEditor(editor),
      onDestroy: () => setEditor(null),
      onUpdate: ({ editor, transaction }) => {
        if (!transaction.docChanged) return
        const html = editor.getHTML()
        externalSyncRef.current.markLocalEdit(html)
        onChange(html)
      },
    },
    []
  )

  const applyContent = useCallback((instance: Editor, next: string) => {
    if (instance.getHTML() === next) return
    const { from, to } = instance.state.selection
    instance.commands.setContent(next, false)
    try {
      instance.commands.setTextSelection({ from, to })
    } catch {
      instance.commands.focus('end')
    }
  }, [])
  const canonicalKey = useCallback((html: string) => html, [])

  const syncHandle = useExternalContentSync<string>({
    editor: editorInstance,
    incoming: content,
    isPickerOpen: false,
    applyContent,
    canonicalKey,
  })
  externalSyncRef.current = syncHandle.current

  useEffect(() => {
    if (!editorInstance || editorInstance.isDestroyed) return
    editorInstance.setEditable(editable)
  }, [editable, editorInstance])

  return (
    <EditorContent
      editor={editorInstance}
      className={cn(
        'w-full h-full flex flex-col bg-transparent px-4 py-3 text-[15px] leading-relaxed text-foreground outline-hidden ring-0 sm:min-h-[120px] *:outline-hidden',
        contentClassName
      )}
    />
  )
}
