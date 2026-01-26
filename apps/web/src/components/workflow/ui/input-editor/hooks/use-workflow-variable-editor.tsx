// apps/web/src/components/workflow/ui/input-editor/hooks/use-workflow-variable-editor.tsx

'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { VariableNode } from '~/components/editor/extensions/variable-node'
import {
  createInlinePickerExtension,
  type InlinePickerState,
} from '~/components/editor/inline-picker'
import {
  tiptapToString,
  stringToTiptap,
  extractVarIds,
  validateTagPattern,
} from '../tiptap-converters'
import type { BaseType } from '~/components/workflow/types'
import type { TableId } from '@auxx/lib/workflow-engine/client'

/** Initial closed state for picker */
const initialPickerState: InlinePickerState = {
  isOpen: false,
  query: '',
  range: null,
  clientRect: null,
}

/**
 * Options for useWorkflowVariableEditor hook
 */
export interface UseWorkflowVariableEditorOptions {
  /** Initial content in {{variableId}} format */
  initialContent?: string
  /** Placeholder text when editor is empty */
  placeholder?: string
  /** Editor class name */
  className?: string
  /** Current node ID for variable context */
  nodeId: string
  /** Expected types for variable filtering */
  expectedTypes?: (BaseType | TableId)[]
  /** Whether editor is editable */
  editable?: boolean
  /** Tab index for keyboard navigation */
  tabIndex?: number
  /** Callback when content changes (debounced) */
  onContentChange?: (content: string) => void
  /** Callback when editor loses focus (debounced) */
  onBlur?: (content: string) => void
  /** Callback when editor gains focus */
  onFocus?: (editor: Editor) => void
  /** Debounce delay for content changes (default: 1000ms) */
  debounceMs?: number
  /** Debounce delay for blur (default: 100ms) */
  blurDebounceMs?: number
}

/**
 * Return type for useWorkflowVariableEditor hook
 */
export interface UseWorkflowVariableEditorReturn {
  /** TipTap editor instance */
  editor: Editor | null
  /** Suggestion state for picker positioning */
  suggestionState: InlinePickerState
  /** Insert a variable at the trigger position */
  insertVariable: (variableId: string) => void
  /** Close picker without inserting */
  closePicker: () => void
  /** Get content as {{variableId}} format string */
  getStringContent: () => string
  /** Set content programmatically */
  setContent: (content: string) => void
  /** Flush pending debounced changes */
  flushPendingChanges: () => void
  /** Whether editor is focused */
  isFocused: boolean
  /** List of used variable IDs */
  usedTags: string[]
  /** Validation result for current content */
  validation: { isValid: boolean; invalidTags: string[] }
  /** Node ID for context */
  nodeId: string
  /** Expected types for filtering */
  expectedTypes: (BaseType | TableId)[]
}

/**
 * Hook for creating workflow variable editors using the inline-picker system.
 *
 * Uses the existing VariableNode extension (with variableId attr) combined with
 * the inline-picker's suggestion extension for trigger detection.
 *
 * Features:
 * - {{variableId}} serialization format
 * - Debounced content changes and blur
 * - Focus state tracking
 * - Picker state for React-driven UI
 */
export function useWorkflowVariableEditor({
  initialContent = '',
  placeholder = 'Enter value or use {variables}',
  className,
  nodeId,
  expectedTypes = [],
  editable = true,
  tabIndex,
  onContentChange,
  onBlur,
  onFocus,
  debounceMs = 1000,
  blurDebounceMs = 100,
}: UseWorkflowVariableEditorOptions): UseWorkflowVariableEditorReturn {
  const [isFocused, setIsFocused] = useState(false)
  const [suggestionState, setSuggestionState] = useState<InlinePickerState>(initialPickerState)

  // Refs for stable closures (prevent stale closures in callbacks)
  const contentRef = useRef(initialContent)
  const lastBlurredContent = useRef(initialContent)
  const onContentChangeRef = useRef(onContentChange)
  const onBlurRef = useRef(onBlur)
  const debounceTimeoutRef = useRef<NodeJS.Timeout>()
  const blurTimeoutRef = useRef<NodeJS.Timeout>()
  const rangeRef = useRef<{ from: number; to: number } | null>(null)

  // Update refs when props change
  useEffect(() => {
    onContentChangeRef.current = onContentChange
  }, [onContentChange])

  useEffect(() => {
    onBlurRef.current = onBlur
  }, [onBlur])

  useEffect(() => {
    lastBlurredContent.current = initialContent
  }, [initialContent])

  // Track range for insertion
  useEffect(() => {
    rangeRef.current = suggestionState.range
  }, [suggestionState.range])

  // Debounced content change
  const debouncedContentChange = useCallback(
    (content: string) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
      debounceTimeoutRef.current = setTimeout(() => {
        if (contentRef.current !== content && onContentChangeRef.current) {
          contentRef.current = content
          onContentChangeRef.current(content)
        }
      }, debounceMs)
    },
    [debounceMs]
  )

  // Debounced blur with value comparison
  const debouncedBlur = useCallback(
    (content: string) => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current)
      }
      blurTimeoutRef.current = setTimeout(() => {
        if (content !== lastBlurredContent.current && onBlurRef.current) {
          lastBlurredContent.current = content
          onBlurRef.current(content)
        }
      }, blurDebounceMs)
    },
    [blurDebounceMs]
  )

  // Cleanup timeouts
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current)
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    }
  }, [])

  // Create picker extension (memoized)
  const pickerExtension = useMemo(
    () =>
      createInlinePickerExtension({
        type: 'variable-node',
        trigger: '{',
        onStateChange: setSuggestionState,
      }),
    []
  )

  // Placeholder extension (memoized)
  const placeholderExtension = useMemo(
    () =>
      Placeholder.configure({
        placeholder,
        showOnlyWhenEditable: true,
        showOnlyCurrent: true,
      }),
    [placeholder]
  )

  // StarterKit extension (memoized)
  const starterKitExtension = useMemo(
    () =>
      StarterKit.configure({
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
      }),
    []
  )

  // Convert initial content from {{variableId}} to TipTap JSON
  const initialTiptapContent = useMemo(() => stringToTiptap(initialContent), [initialContent])

  // Create editor with all extensions
  const editor = useEditor({
    extensions: [starterKitExtension, VariableNode, pickerExtension, placeholderExtension],
    content: initialTiptapContent,
    editable,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class:
          className ||
          'input-editor-content text-sm leading-normal h-full text-foreground whitespace-nowrap overflow-hidden',
        tabindex: tabIndex?.toString() ?? '',
      },
    },
    onUpdate: ({ editor }) => {
      const content = tiptapToString(editor.getJSON())
      debouncedContentChange(content)
    },
    onFocus: ({ editor }) => {
      // if (!isFocused) setIsFocused(true)
      onFocus?.(editor)
    },
    onBlur: ({ editor }) => {
      // Only blur if picker is not open
      if (!suggestionState.isOpen) {
        if (isFocused) setIsFocused(false)
        const content = tiptapToString(editor.getJSON())
        debouncedBlur(content)
      }
    },
  })

  // Store nodeId in editor storage for variable-node access
  useEffect(() => {
    if (editor && nodeId !== undefined) {
      editor.storage.nodeId = nodeId
    }
  }, [editor, nodeId])

  // Insert a variable at trigger position
  const insertVariable = useCallback(
    (variableId: string) => {
      if (!editor || !rangeRef.current) return

      const range = rangeRef.current
      rangeRef.current = null

      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'variable-node', attrs: { variableId } })
        .insertContent(' ')
        .run()

      setSuggestionState(initialPickerState)
    },
    [editor]
  )

  // Close picker without inserting
  const closePicker = useCallback(() => {
    if (editor && rangeRef.current) {
      // Delete the trigger character and query
      editor.chain().focus().deleteRange(rangeRef.current).run()
      rangeRef.current = null
    }
    setSuggestionState(initialPickerState)
  }, [editor])

  // Get content as {{variableId}} format string
  const getStringContent = useCallback(() => {
    return editor ? tiptapToString(editor.getJSON()) : ''
  }, [editor])

  // Set content programmatically
  const setContent = useCallback(
    (content: string) => {
      if (editor) {
        const tiptapContent = stringToTiptap(content)
        editor.commands.setContent(tiptapContent)
        contentRef.current = content
      }
    },
    [editor]
  )

  // Flush pending debounced changes
  const flushPendingChanges = useCallback(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
      const currentContent = editor ? tiptapToString(editor.getJSON()) : ''
      if (contentRef.current !== currentContent && onContentChangeRef.current) {
        contentRef.current = currentContent
        onContentChangeRef.current(currentContent)
      }
    }
  }, [editor])

  // Get used variable IDs (memoized, updates on editor changes)
  const usedTags = useMemo(() => {
    if (!editor) return []
    return extractVarIds(editor.getJSON())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor?.state.doc])

  // Validate current content (memoized)
  const validation = useMemo(() => {
    const content = editor ? tiptapToString(editor.getJSON()) : ''
    return validateTagPattern(content)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor?.state.doc])

  return {
    // Editor
    editor,
    suggestionState,

    // Actions
    insertVariable,
    closePicker,
    getStringContent,
    setContent,
    flushPendingChanges,

    // State
    isFocused,
    usedTags,
    validation,

    // Context
    nodeId,
    expectedTypes,
  }
}
