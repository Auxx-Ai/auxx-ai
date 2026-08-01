// apps/web/src/components/workflow/ui/input-editor/hooks/use-workflow-variable-editor.tsx

'use client'

import { collectVariableIds, docToText, type TiptapDoc, textToDoc } from '@auxx/lib/tiptap'
import type { Extension, JSONContent } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
import { type Editor, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { VariableNode } from '~/components/editor/extensions/variable-node'
import {
  createInlinePickerExtension,
  type InlinePickerState,
  stableStringify,
} from '~/components/editor/inline-picker'
import type { ReferenceTab } from '~/components/editor/inline-picker/nodes/reference-picker-node'
import { buildReferencePickerExtensions } from '~/components/editor/rich-text/reference-picker-extensions'
import type { AllowedVarType } from '~/components/workflow/types'
import { validateTagPattern } from '../tiptap-converters'

/** Initial closed state for picker */
const initialPickerState: InlinePickerState = {
  isOpen: false,
  query: '',
  range: null,
  clientRect: null,
}

/**
 * Options for useWorkflowVariableEditor hook.
 *
 * Two storage modes:
 *  - **string mode** (default): `initialContent` + `onContentChange` use
 *    the legacy `{{variableId}}` text format. Used by 9 workflow node
 *    panels (answer, http, information-extractor, text-classifier, end,
 *    human, http error/body, generate-content-dialog).
 *  - **JSON mode** (opt-in): `valueJson` + `onContentChangeJson` carry the
 *    full Tiptap doc as JSON. Used by the AI node so `reference` chips
 *    keep their `RecordId` attrs through the round-trip (text mode would
 *    flatten them via `docToText`). Mode is selected purely by which
 *    props are supplied — the two modes are not meant to be mixed on the
 *    same mount.
 */
export interface UseWorkflowVariableEditorOptions {
  /** Initial content in {{variableId}} format (string mode). */
  initialContent?: string
  /** Initial content as a full Tiptap doc (JSON mode). */
  valueJson?: TiptapDoc
  /** Placeholder text when editor is empty */
  placeholder?: string
  /** Editor class name */
  className?: string
  /** Current node ID for variable context */
  nodeId: string
  /** Expected types for variable filtering */
  expectedTypes?: AllowedVarType[]
  /** Whether editor is editable */
  editable?: boolean
  /** Tab index for keyboard navigation */
  tabIndex?: number
  /** Callback when content changes (debounced) — string mode. */
  onContentChange?: (content: string) => void
  /** Callback when content changes — JSON mode, fires immediately with the live Tiptap doc. */
  onContentChangeJson?: (doc: TiptapDoc) => void
  /** Callback when editor loses focus (debounced) */
  onBlur?: (content: string) => void
  /** Callback when editor gains focus */
  onFocus?: (editor: Editor) => void
  /** Debounce delay for content changes (default: 1000ms) */
  debounceMs?: number
  /** Debounce delay for blur (default: 100ms) */
  blurDebounceMs?: number
  /** Trigger character(s) to open variable picker (default: '{') */
  trigger?: string
  /**
   * When `true`, mounts the `@`-reference picker extensions
   * (`referenceBadgeNode` + `ReferencePickerNode`). Off by default — only
   * the AI node opts in today. Consumers must mount the popover
   * separately (via `useActivePicker(editor)` + `InlinePickerPopover`).
   */
  enableReferencePicker?: boolean
  /** Tabs the reference picker exposes (defaults to `DEFAULT_TABS`). */
  referenceTabs?: ReferenceTab[]
  /** Forwarded to the reference picker chip — confirm highlighted item. */
  onPickerEnter?: () => boolean
  /** Forwarded to the reference picker chip — move highlight up/down. */
  onPickerArrowVertical?: (direction: 1 | -1) => boolean
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
  expectedTypes: AllowedVarType[]
}

/**
 * Hook for creating workflow variable editors using the inline-picker system.
 *
 * Uses the existing VariableNode extension (with variableId attr) combined with
 * the inline-picker's suggestion extension for trigger detection.
 *
 * Features:
 * - {{variableId}} serialization format (string mode) OR full Tiptap doc
 *   round-trip (JSON mode — opt-in for the AI node, see options docstring).
 * - Debounced content changes and blur
 * - Focus state tracking
 * - Picker state for React-driven UI
 * - Optional `@`-reference picker (opt-in for the AI node).
 */
export function useWorkflowVariableEditor({
  initialContent = '',
  valueJson,
  placeholder = 'Enter value or use {variables}',
  className,
  nodeId,
  expectedTypes = [],
  editable = true,
  tabIndex,
  onContentChange,
  onContentChangeJson,
  onBlur,
  onFocus,
  debounceMs = 1000,
  blurDebounceMs = 100,
  trigger = '{',
  enableReferencePicker = false,
  referenceTabs,
  onPickerEnter,
  onPickerArrowVertical,
}: UseWorkflowVariableEditorOptions): UseWorkflowVariableEditorReturn {
  // JSON mode is selected when the caller supplies `valueJson`. We capture
  // this once at mount via a ref — toggling modes after mount is unsupported
  // (would require destroying / recreating the editor instance).
  const isJsonMode = valueJson !== undefined
  const isJsonModeRef = useRef(isJsonMode)

  const [isFocused, setIsFocused] = useState(false)
  const [suggestionState, setSuggestionState] = useState<InlinePickerState>(initialPickerState)

  // Refs for stable closures (prevent stale closures in callbacks)
  const contentRef = useRef(initialContent)
  const lastBlurredContent = useRef(initialContent)
  const onContentChangeRef = useRef(onContentChange)
  const onContentChangeJsonRef = useRef(onContentChangeJson)
  const onBlurRef = useRef(onBlur)
  const debounceTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const blurTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const rangeRef = useRef<{ from: number; to: number } | null>(null)

  // JSON-mode loop guard: every `setInputs` on the parent rebuilds the
  // prompt template object, which would re-fire onChange and bounce a
  // fresh patch back. Compare the stable-stringified doc against the
  // last saved hash and skip when equal. Seed with the initial doc so
  // the very first emit (driven by Tiptap's initial onUpdate) is deduped.
  const lastSavedJsonKeyRef = useRef<string>(isJsonMode ? stableStringify(valueJson) : '')

  // Update refs when props change
  useEffect(() => {
    onContentChangeRef.current = onContentChange
  }, [onContentChange])

  useEffect(() => {
    onContentChangeJsonRef.current = onContentChangeJson
  }, [onContentChangeJson])

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
        trigger,
        onStateChange: setSuggestionState,
      }),
    [trigger]
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

  // Reference picker bundle (opt-in). Mounted alongside the `{`-picker so
  // the AI node gets BOTH `{`-vars and `@`-references in one editor.
  const referencePickerExtensions = useMemo<Extension[]>(
    () =>
      enableReferencePicker
        ? (buildReferencePickerExtensions({
            onPickerEnter,
            onPickerArrowVertical,
            referenceTabs,
          }) as unknown as Extension[])
        : [],
    [enableReferencePicker, onPickerEnter, onPickerArrowVertical, referenceTabs]
  )

  // Snapshot the initial Tiptap content — JSON mode reads `valueJson`
  // directly (no text round-trip would lose `reference` chip attrs);
  // string mode runs the existing `textToDoc` parse.
  // biome-ignore lint/correctness/useExhaustiveDependencies: snapshot at mount only — see JSON-mode contract above
  const initialTiptapContent = useMemo<JSONContent>(() => {
    if (isJsonModeRef.current) {
      return (valueJson as JSONContent) ?? { type: 'doc', content: [] }
    }
    return textToDoc(initialContent, { parseVariables: true }) as JSONContent
  }, [])

  // Create editor with all extensions
  const editor = useEditor({
    extensions: [
      starterKitExtension,
      VariableNode,
      pickerExtension,
      ...referencePickerExtensions,
      placeholderExtension,
    ],
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
      if (isJsonModeRef.current) {
        const json = editor.getJSON() as TiptapDoc
        const key = stableStringify(json)
        if (key === lastSavedJsonKeyRef.current) return
        lastSavedJsonKeyRef.current = key
        onContentChangeJsonRef.current?.(json)
        return
      }
      const content = docToText(editor.getJSON())
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
        if (isJsonModeRef.current) return
        const content = docToText(editor.getJSON())
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
    return editor ? docToText(editor.getJSON()) : ''
  }, [editor])

  // Set content programmatically (skips echoed values from our own onChange).
  // In JSON mode this is a no-op: callers shouldn't externally drive the
  // editor (see JSON-mode contract above — uncontrolled after mount).
  const setContent = useCallback(
    (content: string) => {
      if (!editor) return
      if (isJsonModeRef.current) return

      // If the incoming content matches what we last sent to the parent via
      // onContentChange, this is just an echo of our own edit bouncing back
      // through the parent's state. Replacing the editor content would destroy
      // the cursor position and close the variable picker.
      if (content === contentRef.current) return

      const tiptapContent = textToDoc(content, { parseVariables: true })
      editor.commands.setContent(tiptapContent)
      contentRef.current = content
    },
    [editor]
  )

  // Flush pending debounced changes
  const flushPendingChanges = useCallback(() => {
    if (isJsonModeRef.current) return
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
      const currentContent = editor ? docToText(editor.getJSON()) : ''
      if (contentRef.current !== currentContent && onContentChangeRef.current) {
        contentRef.current = currentContent
        onContentChangeRef.current(currentContent)
      }
    }
  }, [editor])

  // Get used variable IDs (memoized, updates on editor changes)
  // biome-ignore lint/correctness/useExhaustiveDependencies: editor.getJSON and editor are accessed via editor?.state.doc as a change signal
  const usedTags = useMemo(() => {
    if (!editor) return []
    return collectVariableIds(editor.getJSON())
  }, [editor?.state.doc])

  // Validate current content (memoized)
  // biome-ignore lint/correctness/useExhaustiveDependencies: editor.getJSON and editor are accessed via editor?.state.doc as a change signal
  const validation = useMemo(() => {
    const content = editor ? docToText(editor.getJSON()) : ''
    return validateTagPattern(content)
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
