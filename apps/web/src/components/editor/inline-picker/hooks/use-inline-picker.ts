// apps/web/src/components/editor/inline-picker/hooks/use-inline-picker.ts

'use client'

import Placeholder from '@tiptap/extension-placeholder'
import { type JSONContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { escapeHtml } from '~/lib/sanitize'
import { createInlineNode } from '../core/inline-node'
import { createInlinePickerExtension } from '../core/inline-picker-extension'
import type {
  InlinePickerState,
  PastePatternConfig,
  UseInlinePickerOptions,
  UseInlinePickerReturn,
} from '../types'

/**
 * Preprocesses content by converting pattern matches to HTML spans.
 * This allows setContent and initialContent to recognize serialized patterns like @[id] or {id}.
 *
 * @param content - Raw HTML/text content
 * @param type - Node type (e.g., 'mention', 'record-link')
 * @param pastePattern - Pattern configuration from the picker
 * @returns Content with patterns converted to span elements
 */
function preprocessContent(
  content: string,
  type: string,
  pastePattern?: PastePatternConfig
): string {
  if (!pastePattern || typeof content !== 'string') return content

  const { pattern, getId } = pastePattern
  const globalPattern = new RegExp(pattern.source, 'g')

  // `matchAll` yields genuine match arrays, so `getId` sees real capture
  // groups (including `undefined` for a group that didn't participate, which
  // the `match[1] ?? match[2]` implementors rely on) plus `index`/`input`.
  // The previous `String.replace` callback had to rebuild that shape by hand.
  let out = ''
  let lastIndex = 0
  for (const match of content.matchAll(globalPattern)) {
    out += content.slice(lastIndex, match.index)
    // Empty span - React NodeView replaces content with badge component
    out += `<span data-type="${type}" data-id="${escapeHtml(getId(match))}"></span>`
    lastIndex = match.index + match[0].length
  }
  return out + content.slice(lastIndex)
}

/** Initial closed state */
const initialState: InlinePickerState = {
  isOpen: false,
  query: '',
  range: null,
  clientRect: null,
}

/**
 * Main hook for creating inline picker editors.
 *
 * Handles ALL editor setup internally:
 * - StarterKit with sensible defaults (no headings, blockquotes, etc.)
 * - Placeholder extension
 * - Inline node definition with keyboard shortcuts, paste handling, and input rules
 * - Suggestion extension for trigger character
 *
 * Simplified design:
 * - Nodes only store `id`
 * - Badge component handles display lookup
 *
 * @param options - Configuration options
 * @returns Editor instance and picker controls
 */
export function useInlinePicker({
  type,
  trigger,
  initialContent = '',
  placeholder,
  serialize = (id) => `${trigger}${id}`,
  renderBadge,
  pastePattern,
  inputRules,
  extensions = [],
  onUpdate,
  onJsonUpdate,
  editable = true,
  editorClassName = 'focus:outline-none min-h-[40px] p-2',
  immediatelyRender = false,
}: UseInlinePickerOptions): UseInlinePickerReturn {
  const [suggestionState, setSuggestionState] = useState<InlinePickerState>(initialState)
  const rangeRef = useRef<{ from: number; to: number } | null>(null)
  const onUpdateRef = useRef(onUpdate)
  const onJsonUpdateRef = useRef(onJsonUpdate)

  // Keep refs updated
  useEffect(() => {
    onUpdateRef.current = onUpdate
    onJsonUpdateRef.current = onJsonUpdate
  }, [onUpdate, onJsonUpdate])

  // Track range for insertion
  useEffect(() => {
    rangeRef.current = suggestionState.range
  }, [suggestionState.range])

  // Create the picker extension (memoized)
  const pickerExtension = useMemo(
    () =>
      createInlinePickerExtension({
        type,
        trigger,
        onStateChange: setSuggestionState,
      }),
    [type, trigger]
  )

  // Create the node extension (memoized)
  const nodeExtension = useMemo(
    () =>
      createInlineNode(
        {
          type,
          serialize,
          pastePattern,
          inputRules,
        },
        renderBadge
      ),
    [type, serialize, renderBadge, pastePattern, inputRules]
  )

  // Preprocess initialContent to convert patterns to spans
  const processedInitialContent = useMemo(
    () =>
      typeof initialContent === 'string'
        ? preprocessContent(initialContent, type, pastePattern)
        : initialContent,
    [initialContent, type, pastePattern]
  )

  // Build editor with all configuration handled internally
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable block-level elements for inline-focused editing
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      nodeExtension,
      pickerExtension,
      ...(placeholder ? [Placeholder.configure({ placeholder, showOnlyWhenEditable: true })] : []),
      ...extensions,
    ],
    content: processedInitialContent,
    editable,
    immediatelyRender,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: editorClassName,
      },
    },
    onUpdate: ({ editor }) => {
      onUpdateRef.current?.(editor)
      onJsonUpdateRef.current?.(editor.getJSON())
    },
  })

  // Insert item at trigger position
  const insertItem = useCallback(
    (id: string) => {
      if (!editor || !rangeRef.current) return

      const range = rangeRef.current
      rangeRef.current = null

      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type, attrs: { id } })
        .insertContent(' ')
        .run()

      setSuggestionState(initialState)
    },
    [editor, type]
  )

  // Close picker without inserting
  const closePicker = useCallback(() => {
    if (editor && rangeRef.current) {
      // Delete the trigger character and query
      editor.chain().focus().deleteRange(rangeRef.current).run()
      rangeRef.current = null
    }
    setSuggestionState(initialState)
  }, [editor])

  // Get HTML content
  const getHTML = useCallback(() => {
    return editor?.getHTML() ?? ''
  }, [editor])

  // Get plain text content
  const getText = useCallback(() => {
    return editor?.getText() ?? ''
  }, [editor])

  // Get JSON content
  const getJSON = useCallback(() => {
    return editor?.getJSON()
  }, [editor])

  // Set content programmatically (with pattern preprocessing)
  const setContent = useCallback(
    (content: string | JSONContent) => {
      if (!editor) return
      const processed =
        typeof content === 'string' ? preprocessContent(content, type, pastePattern) : content
      editor.commands.setContent(processed)
    },
    [editor, type, pastePattern]
  )

  return {
    editor,
    suggestionState,
    insertItem,
    closePicker,
    getHTML,
    getText,
    getJSON,
    setContent,
  }
}
