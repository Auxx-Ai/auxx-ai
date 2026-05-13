// apps/web/src/components/editor/inline-picker/hooks/use-reference-editor.tsx

'use client'

import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import type { ActorId } from '@auxx/types/actor'
import { cn } from '@auxx/ui/lib/utils'
import type { Editor, JSONContent } from '@tiptap/react'
import { useCallback } from 'react'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { ThreadBadge } from '~/components/threads/ui/thread-badge'
import { useInlinePicker } from './use-inline-picker'

interface UseReferenceEditorOptions {
  initialContent?: string
  placeholder?: string
  onUpdate?: (html: string, editor: Editor) => void
  onJsonUpdate?: (json: JSONContent) => void
  editable?: boolean
  extensions?: unknown[]
  className?: string
}

/**
 * Inline-picker editor for `@`-mentions that emit any RecordId — actors,
 * records, threads, drafts, articles. Sibling to `useMentionEditor` (which
 * stays actor-only for tasks/comments).
 */
export function useReferenceEditor(options: UseReferenceEditorOptions = {}) {
  const {
    initialContent = '',
    placeholder,
    onUpdate,
    onJsonUpdate,
    editable = true,
    extensions = [],
    className,
  } = options

  const renderBadge = useCallback(({ id, selected }: { id: string; selected: boolean }) => {
    const ringCls = cn(
      'transition-all inline-flex',
      selected && 'ring-2 ring-primary ring-offset-1'
    )

    if (id.startsWith('user:') || id.startsWith('group:')) {
      return <ActorBadge actorId={id as ActorId} className={ringCls} />
    }
    if (id.startsWith('thread:') || id.startsWith('draft:')) {
      try {
        const { entityInstanceId } = parseRecordId(id as RecordId)
        return <ThreadBadge threadId={entityInstanceId} className={ringCls} />
      } catch {
        return <RecordBadge recordId={id as RecordId} className={ringCls} />
      }
    }
    return <RecordBadge recordId={id as RecordId} className={ringCls} />
  }, [])

  const picker = useInlinePicker({
    type: 'reference',
    trigger: '@',
    renderBadge,
    serialize: (id) => `@[${id}]`,
    initialContent,
    placeholder,
    editable,
    extensions,
    editorClassName: className,
    onUpdate: onUpdate ? (editor) => onUpdate(editor.getHTML(), editor) : undefined,
    onJsonUpdate,
    pastePattern: {
      pattern: /@\[([^\]]+)\]/,
      getId: (match) => match[1]!,
    },
  })

  const insertReference = useCallback(
    (recordId: RecordId) => {
      picker.insertItem(recordId)
    },
    [picker]
  )

  return {
    ...picker,
    insertReference,
  }
}
