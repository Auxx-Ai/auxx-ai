// apps/web/src/components/editor/inline-picker/hooks/use-mention-editor.tsx

'use client'

import { useCallback } from 'react'
import { useInlinePicker } from './use-inline-picker'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { cn } from '@auxx/ui/lib/utils'
import type { ActorId } from '@auxx/types/actor'
import type { Editor, JSONContent } from '@tiptap/react'

/** Options for useMentionEditor hook */
interface UseMentionEditorOptions {
  /** Initial HTML content */
  initialContent?: string
  /** Placeholder text */
  placeholder?: string
  /** Callback when content changes */
  onUpdate?: (html: string, editor: Editor) => void
  /** Callback when JSON changes */
  onJsonUpdate?: (json: JSONContent) => void
  /** Enable editable mode (default: true) */
  editable?: boolean
  /** Additional TipTap extensions */
  extensions?: unknown[]
  /** Custom editor class name */
  className?: string
}

/**
 * Pre-built hook for mention editing with ActorPicker integration.
 * Uses '@' as trigger and renders ActorBadge for mentions.
 * Badge looks up actor display info by id.
 *
 * @param options - Configuration options
 * @returns Editor instance and mention-specific controls
 */
export function useMentionEditor(options: UseMentionEditorOptions = {}) {
  const { initialContent = '', placeholder, onUpdate, onJsonUpdate, editable = true, extensions = [], className } = options

  // Render badge using ActorBadge component with selection styling
  // ActorBadge handles looking up actor info by id
  const renderBadge = useCallback(({ id, selected }: { id: string; selected: boolean }) => (<ActorBadge actorId={id as ActorId} className={cn('transition-all', selected && 'ring-2 ring-primary ring-offset-1')} />),[])

  const picker = useInlinePicker({
    type: 'mention',
    trigger: '@',
    renderBadge,
    serialize: (id) => `@[${id}]`, // Serialization includes id for paste parsing
    initialContent,
    placeholder,
    editable,
    extensions,
    editorClassName: className,
    onUpdate: onUpdate ? (editor) => onUpdate(editor.getHTML(), editor) : undefined,
    onJsonUpdate,
    // Paste pattern: @[id] format
    pastePattern: {
      pattern: /@\[([^\]]+)\]/,
      getId: (match) => match[1]!,
    },
  })

  // Helper to insert mention by ActorId
  const insertMention = useCallback(
    (actorId: ActorId) => {
      picker.insertItem(actorId)
    },
    [picker]
  )

  return {
    ...picker,
    insertMention,
  }
}
