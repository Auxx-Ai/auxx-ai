// apps/web/src/components/editor/inline-picker/hooks/use-reference-picker-editor.tsx

'use client'

import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import type { ActorId } from '@auxx/types/actor'
import { cn } from '@auxx/ui/lib/utils'
import Placeholder from '@tiptap/extension-placeholder'
import { type Editor, type JSONContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback } from 'react'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { ThreadBadge } from '~/components/threads/ui/thread-badge'
import { createInlineNode } from '../core/inline-node'
import { ReferencePickerNode } from '../nodes/reference-picker-node'

interface UseReferencePickerEditorOptions {
  initialContent?: string
  placeholder?: string
  onUpdate?: (html: string, editor: Editor) => void
  onJsonUpdate?: (json: JSONContent) => void
  editable?: boolean
  extensions?: unknown[]
  className?: string
  /** Called when Enter is pressed inside the open picker chip. */
  onPickerEnter?: () => boolean
  /** Called when ArrowUp/Down is pressed inside the open picker chip. */
  onPickerArrowVertical?: (direction: 1 | -1) => boolean
}

const referenceBadgeRing = 'transition-all inline-flex'

function renderReferenceBadge({ id, selected }: { id: string; selected: boolean }) {
  const ring = cn(referenceBadgeRing, selected && 'ring-2 ring-primary ring-offset-1')
  if (id.startsWith('user:') || id.startsWith('group:')) {
    return <ActorBadge actorId={id as ActorId} className={ring} />
  }
  if (id.startsWith('thread:') || id.startsWith('draft:')) {
    try {
      const { entityInstanceId } = parseRecordId(id as RecordId)
      return <ThreadBadge threadId={entityInstanceId} className={ring} />
    } catch {
      return <RecordBadge recordId={id as RecordId} className={ring} />
    }
  }
  return <RecordBadge recordId={id as RecordId} className={ring} />
}

const referenceBadgeNode = createInlineNode(
  {
    type: 'reference',
    serialize: (id) => `@[${id}]`,
    pastePattern: {
      pattern: /@\[([^\]]+)\]/,
      getId: (match) => match[1]!,
    },
  },
  renderReferenceBadge
)

/**
 * Editor hook for the inline-node-based `@` picker.
 *
 * The chip node (`referencePicker`) is transient — it represents an open
 * picker. On confirm it collapses into the `reference` badge node, which is
 * the persisted form.
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
    onPickerEnter,
    onPickerArrowVertical,
  } = options

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
      referenceBadgeNode,
      ReferencePickerNode.configure({
        onEnter: onPickerEnter,
        onArrowVertical: onPickerArrowVertical,
      }),
      ...(placeholder ? [Placeholder.configure({ placeholder, showOnlyWhenEditable: true })] : []),
      ...(extensions as []),
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
