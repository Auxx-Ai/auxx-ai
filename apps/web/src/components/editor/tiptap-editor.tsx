// apps/web/src/components/editor/tiptap-editor.tsx

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
import { useEditorContext } from './editor-context'
import { FontSize } from './extensions'
import { Indent } from './extensions/indent'
import {
  createPlaceholderNode,
  InlinePickerPopover,
  PlaceholderBadge,
  useExternalContentSync,
} from './inline-picker'
import { useSlashCommand } from './inline-picker/hooks/use-slash-command'
import { SlashCommandPicker } from './slash-command-picker'

type TiptapEditorProps = {
  content: string
  onChange: (html: string) => void
  placeholder?: string
  className?: string
  editable?: boolean
  /** Extra class (e.g. z-index override) for the slash-command popover content. */
  popoverClassName?: string
  /** When provided, plain Enter (no shift) calls this handler instead of inserting a paragraph break. */
  onEnter?: () => void
}

const TiptapEditor = ({
  content,
  onChange,
  placeholder = 'Type your reply here...',
  className = '',
  editable = true,
  popoverClassName,
  onEnter,
}: TiptapEditorProps) => {
  const { setEditor } = useEditorContext()
  const slashCommand = useSlashCommand()
  const externalSyncRef = useRef<{ markLocalEdit: (key: string) => void }>({
    markLocalEdit: () => {},
  })
  const onEnterRef = useRef<(() => void) | undefined>(onEnter)
  onEnterRef.current = onEnter

  const placeholderNodeExtension = useMemo(
    () => createPlaceholderNode((badgeProps) => <PlaceholderBadge {...badgeProps} />),
    []
  )

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Indent,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder }),
      slashCommand.slashCommandExtension,
      placeholderNodeExtension,
    ],
    [placeholder, slashCommand.slashCommandExtension, placeholderNodeExtension]
  )

  const editorInstance = useEditor(
    {
      extensions,
      content: content,
      shouldRerenderOnTransaction: false,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: cn(
            'tiptap-email-editor prose prose-sm prose-headings:my-1 prose-ul:my-1 prose-p:my-0 prose-li:my-0 focus:outline-hidden max-w-none dark:prose-invert flex-1',
            className
          ),
        },
        handleKeyDown: (_view, event) => {
          if (
            onEnterRef.current &&
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !slashCommand.isOpenRef.current
          ) {
            event.preventDefault()
            onEnterRef.current()
            return true
          }
          return false
        },
      },
      onCreate: ({ editor }) => {
        setEditor(editor)
        slashCommand.setEditor(editor)
      },
      onDestroy: () => {
        setEditor(null)
        slashCommand.setEditor(null)
      },
      onUpdate: ({ editor, transaction }) => {
        if (!transaction.docChanged) return
        if (slashCommand.isOpenRef.current) return
        // Defer onChange — the Suggestion plugin's onStart fires after
        // onUpdate in the same tick, so we need to let it set isOpenRef
        // before deciding whether to propagate the change.
        const html = editor.getHTML()
        setTimeout(() => {
          if (slashCommand.isOpenRef.current) return
          externalSyncRef.current.markLocalEdit(html)
          onChange(html)
        }, 0)
      },
    },
    []
  )

  const applyContent = useCallback((instance: Editor, next: string) => {
    // Skip when the editor already matches — useEditor initialized with
    // the same HTML, so a redundant setContent here would trigger
    // TipTap's React adapters to flushSync during commit.
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
    isPickerOpen: slashCommand.suggestionState.isOpen,
    applyContent,
    canonicalKey,
  })
  externalSyncRef.current = syncHandle.current

  // Flush deferred outbound onChange when the slash picker closes.
  const prevSlashOpen = useRef(false)
  useEffect(() => {
    if (prevSlashOpen.current && !slashCommand.suggestionState.isOpen && editorInstance) {
      onChange(editorInstance.getHTML())
    }
    prevSlashOpen.current = slashCommand.suggestionState.isOpen
  }, [slashCommand.suggestionState.isOpen, editorInstance, onChange])

  // Synchronize editable state
  useEffect(() => {
    if (!editorInstance || editorInstance.isDestroyed) return
    editorInstance.setEditable(editable)
  }, [editable, editorInstance])

  return (
    <>
      <EditorContent
        editor={editorInstance}
        className={cn(
          'w-full h-full flex flex-col bg-transparent px-4 py-3 text-[15px] leading-relaxed text-foreground outline-hidden ring-0 sm:min-h-[120px] *:outline-hidden'
        )}
      />
      <InlinePickerPopover
        state={slashCommand.suggestionState}
        onClose={slashCommand.closePicker}
        width={288}
        className={popoverClassName}>
        <SlashCommandPicker
          query={slashCommand.suggestionState.query}
          onExecute={slashCommand.executeCommand}
          onClose={slashCommand.closePicker}
        />
      </InlinePickerPopover>
    </>
  )
}

export default TiptapEditor
