// apps/web/src/components/editor/inline-picker/hooks/use-record-link-editor.tsx

'use client'

import { useCallback } from 'react'
import { useInlinePicker } from './use-inline-picker'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { cn } from '@auxx/ui/lib/utils'
import type { RecordId } from '@auxx/types/resource'
import type { Editor, JSONContent } from '@tiptap/react'

/** Options for useRecordLinkEditor hook */
interface UseRecordLinkEditorOptions {
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
 * Pre-built hook for record link editing with RecordPicker integration.
 * Uses '#' as trigger and renders RecordBadge for record links.
 * Badge looks up record display info by id.
 *
 * @param options - Configuration options
 * @returns Editor instance and record-link-specific controls
 */
export function useRecordLinkEditor(options: UseRecordLinkEditorOptions = {}) {
  const { initialContent = '', placeholder, onUpdate, onJsonUpdate, editable = true, extensions = [], className } = options

  // Render badge using RecordBadge component with selection styling
  const renderBadge = useCallback(
    ({ id, selected }: { id: string; selected: boolean }) => (
      <RecordBadge
        recordId={id as RecordId}
        className={cn(
          'transition-all',
          selected && 'ring-2 ring-primary ring-offset-1'
        )}
      />
    ),
    []
  )

  const picker = useInlinePicker({
    type: 'record-link',
    trigger: '#',
    renderBadge,
    serialize: (id) => `{${id}}`,
    initialContent,
    placeholder,
    editable,
    extensions,
    editorClassName: className,
    onUpdate: onUpdate ? (editor) => onUpdate(editor.getHTML(), editor) : undefined,
    onJsonUpdate,
    // Paste/load pattern: support both #[id] and {id} formats
    pastePattern: {
      pattern: /(?:#\[([^\]]+)\]|\{([^\}]+)\})/,
      getId: (match) => match[1] ?? match[2]!,
    },
  })

  // Helper to insert record link
  const insertRecordLink = useCallback(
    (recordId: RecordId) => {
      picker.insertItem(recordId)
    },
    [picker]
  )

  return {
    ...picker,
    insertRecordLink,
  }
}
