// apps/web/src/components/editor/inline-picker/hooks/use-reference-picker-editor.tsx

'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import type { AnyExtension } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
import { type Editor, type JSONContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useMemo } from 'react'
import { buildReferencePickerExtensions } from '../../rich-text/reference-picker-extensions'

interface UseReferencePickerEditorOptions {
  initialContent?: string
  placeholder?: string
  onUpdate?: (html: string, editor: Editor) => void
  onJsonUpdate?: (json: JSONContent) => void
  editable?: boolean
  extensions?: AnyExtension[]
  className?: string
  /** Mount the `@`-mention reference picker. Default: true. */
  enableReferencePicker?: boolean
  /** Called when Enter is pressed inside the open picker chip. */
  onPickerEnter?: () => boolean
  /** Called when ArrowUp/Down is pressed inside the open picker chip. */
  onPickerArrowVertical?: (direction: 1 | -1) => boolean
  /** Mount the `/` slash trigger on the same chip node. Default: false. */
  enableSlash?: boolean
  /** Enter inside an open `/` chip — confirm the highlighted slash item. */
  onSlashEnter?: () => boolean
  /** ArrowUp/Down inside an open `/` chip — move the slash list highlight. */
  onSlashArrowVertical?: (direction: 1 | -1) => boolean
  /** Backspace/ArrowLeft on an empty, drilled `/` chip — pop a drill level. */
  onSlashBackspacePop?: () => boolean
  /** ArrowRight inside an open `/` chip — drill into the highlighted item. */
  onSlashArrowRight?: () => boolean
}

/**
 * Editor hook for the inline-node-based `@` picker.
 *
 * The chip node (`referencePicker`) is transient — it represents an open
 * picker. On confirm it collapses into the `reference` badge node, which is
 * the persisted form.
 *
 * This is the Kopilot-composer-style mount. For full rich-text editors
 * (KB articles, agent persona) use `useRichTextEditor`, which mounts the
 * same picker extensions alongside the article block set.
 */
export function useReferencePickerEditor(options: UseReferencePickerEditorOptions = {}) {
  const {
    initialContent = '',
    placeholder,
    onUpdate,
    onJsonUpdate,
    editable = true,
    extensions = [],
    className,
    enableReferencePicker = true,
    onPickerEnter,
    onPickerArrowVertical,
    enableSlash = false,
    onSlashEnter,
    onSlashArrowVertical,
    onSlashBackspacePop,
    onSlashArrowRight,
  } = options

  // Mount the chip node when EITHER trigger is enabled. `mention` gates the
  // `@` trigger and `slash` gates `/`, so a slash-only surface (reference
  // picker off) still gets the `/` chip.
  const referencePickerExtensions = useMemo(
    () =>
      enableReferencePicker || enableSlash
        ? buildReferencePickerExtensions({
            mention: enableReferencePicker,
            onPickerEnter,
            onPickerArrowVertical,
            slash: enableSlash,
            onSlashEnter,
            onSlashArrowVertical,
            onSlashBackspacePop,
            onSlashArrowRight,
          })
        : [],
    [
      enableReferencePicker,
      onPickerEnter,
      onPickerArrowVertical,
      enableSlash,
      onSlashEnter,
      onSlashArrowVertical,
      onSlashBackspacePop,
      onSlashArrowRight,
    ]
  )

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      ...referencePickerExtensions,
      ...(placeholder ? [Placeholder.configure({ placeholder, showOnlyWhenEditable: true })] : []),
      ...extensions,
    ],
    content: initialContent,
    editable,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: className ?? 'focus:outline-none min-h-[40px] p-2',
      },
    },
    onUpdate: ({ editor }) => {
      onUpdate?.(editor.getHTML(), editor)
      onJsonUpdate?.(editor.getJSON())
    },
  })

  const confirmReference = useCallback(
    (recordId: RecordId) => {
      if (!editor) return
      editor.commands.confirmReferencePicker(recordId)
    },
    [editor]
  )

  const closePicker = useCallback(
    (opts?: { keepText?: boolean }) => {
      if (!editor) return
      editor.commands.closeReferencePicker(opts)
    },
    [editor]
  )

  return { editor, confirmReference, closePicker }
}
