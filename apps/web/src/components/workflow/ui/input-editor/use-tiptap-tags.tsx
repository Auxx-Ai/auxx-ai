import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { VariableNode } from '~/components/editor/extensions/variable-node'

import {
  tiptapToString,
  stringToTiptap,
  extractVarIds,
  validateTagPattern,
} from './tiptap-converters'
import { createWorkflowVariablePickerExtension } from '../prompt-editor'
import type { BaseType } from '~/components/workflow/types'
import Placeholder from '@tiptap/extension-placeholder'
import type { TableId } from '@auxx/lib/workflow-engine/client'

export interface TagData {
  variableId: string
}

export interface UseTiptapTagsOptions {
  initialContent?: string
  onContentChange?: (content: string) => void
  onBlur?: (content: string) => void
  onFocus?: (editor: any) => void
  expectedTypes?: (BaseType | TableId)[]
  editorOptions?: { placeholder?: string; className?: string }
  debounceMs?: number
  blurDebounceMs?: number
  nodeId: string
  tabIndex?: number
}

export const useTiptapTags = ({
  initialContent = '',
  onContentChange,
  onBlur,
  onFocus,
  expectedTypes = [],
  editorOptions = {},
  debounceMs = 1000,
  blurDebounceMs = 100,
  nodeId,
  tabIndex,
}: UseTiptapTagsOptions) => {
  const [stringContent, setStringContent] = useState(initialContent)
  const [isConstantMode, setIsConstantMode] = useState(false)

  // Refs for stable references and avoiding stale closures
  const contentRef = useRef(initialContent)
  const lastBlurredContent = useRef(initialContent)
  const onContentChangeRef = useRef(onContentChange)
  const onBlurRef = useRef(onBlur)
  const debounceTimeoutRef = useRef<NodeJS.Timeout>()
  const blurTimeoutRef = useRef<NodeJS.Timeout>()

  const [isFocused, setIsFocused] = useState(false)

  // Update refs when props change
  useEffect(() => {
    onContentChangeRef.current = onContentChange
  }, [onContentChange])

  useEffect(() => {
    onBlurRef.current = onBlur
  }, [onBlur])

  // Update lastBlurredContent when initialContent changes
  useEffect(() => {
    lastBlurredContent.current = initialContent
  }, [initialContent])

  // Debounced content change function
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

  // Debounced blur function with value comparison
  const debouncedBlur = useCallback(
    (content: string) => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current)
      }

      blurTimeoutRef.current = setTimeout(() => {
        // Only call onBlur if content actually changed
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
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current)
      }
    }
  }, [])

  // Memoized initial content to prevent unnecessary editor recreations
  const initialTiptapContent = useMemo(() => {
    return stringToTiptap(initialContent)
  }, [initialContent])

  // Stable editor configuration
  const editorConfig = useMemo(
    () => ({
      extensions: [
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
        VariableNode,
        createWorkflowVariablePickerExtension(nodeId, expectedTypes),
        Placeholder.configure({
          placeholder: editorOptions.placeholder || 'Enter value or use {variables}',
          showOnlyWhenEditable: true,
          showOnlyCurrent: true, // We need this for AI and other node to be true. so the placeholder doesn't repeat on every empty line
        }),
      ],
      content: initialTiptapContent,
      onUpdate: ({ editor }) => {
        if (!isConstantMode) {
          const content = tiptapToString(editor.getJSON())
          // setting the string content before the variable content will reset tiptap before calling the debounced change.
          // setStringContent(content)
          debouncedContentChange(content)
        }
      },
      onFocus: ({ editor }) => {
        // Reset blur timeout when editor is focused
        onFocus?.(editor)
        if (!isFocused) {
          setIsFocused(true)
        }
      },
      onBlur: ({ editor }) => {
        const plugins = editor.state.plugins

        // Find the plugin with the key 'workflow-variable-picker-suggestion'
        const variablePickerPlugin = plugins.find(
          (plugin) => plugin.key === 'workflow-variable-picker-suggestion$'
        )
        const suggestionState = variablePickerPlugin?.getState(editor.state)

        // Check if the workflow variable picker is active
        const isVariablePickerActive = suggestionState?.active || false

        // Only call onChange if the variable picker is not active
        if (!isVariablePickerActive) {
          // Call onChange with the latest content when editor loses focus
          if (isFocused) setIsFocused(false)
          if (!isConstantMode) {
            const content = tiptapToString(editor.getJSON())
            debouncedBlur(content)
          }
        }
      },
      editorProps: {
        attributes: {
          class:
            editorOptions.className ||
            'input-editor-content text-sm leading-normal h-full text-foreground whitespace-nowrap overflow-hidden',
          tabindex: tabIndex ?? undefined,
          // placeholder: editorOptions.placeholder || 'Start typing...',
        },
      },
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
    }),
    [initialTiptapContent, isConstantMode, debouncedContentChange, debouncedBlur, editorOptions]
  )

  // Initialize editor with memoized config
  const editor = useEditor(editorConfig)

  // Convert string content to editor content - optimized with useCallback
  const applyStringContent = useCallback(() => {
    if (!editor || !isConstantMode) return { success: false, error: 'Not in string mode' }

    const validation = validateTagPattern(stringContent)
    if (!validation.isValid) {
      return { success: false, error: `Invalid tags found: ${validation.invalidTags.join(', ')}` }
    }

    try {
      const tiptapContent = stringToTiptap(stringContent)
      editor.commands.setContent(tiptapContent)

      // Update content ref and call onChange immediately for string mode changes
      if (contentRef.current !== stringContent && onContentChangeRef.current) {
        contentRef.current = stringContent
        onContentChangeRef.current(stringContent)
      }

      setIsConstantMode(false)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to apply content',
      }
    }
  }, [editor, isConstantMode, stringContent])

  // Toggle between rich and string editing modes - stable reference
  // const toggleMode = useCallback(() => {
  //   if (isConstantMode) {
  //     return applyStringContent()
  //   } else {
  //     setIsConstantMode(true)
  //     return { success: true }
  //   }
  // }, [isConstantMode, applyStringContent])

  // Insert a tag at cursor position - stable reference
  const insertTag = useCallback(
    (varId: string, label?: string) => {
      if (!editor) return false

      try {
        editor
          .chain()
          .focus()
          .insertContent({ type: 'variable-node', attrs: { variableId: varId } })
          .run()
        return true
      } catch {
        return false
      }
    },
    [editor]
  )

  // Update string content - optimized to prevent unnecessary updates
  const updateStringContent = useCallback(
    (content: string) => {
      if (content !== stringContent) {
        setStringContent(content)
        if (!isConstantMode && onContentChangeRef.current) {
          debouncedContentChange(content)
        }
      }
    },
    [stringContent, isConstantMode, debouncedContentChange]
  )

  // Set content programmatically - stable reference
  const setContent = useCallback(
    (content: string) => {
      if (content !== stringContent) {
        setStringContent(content)
        if (editor && !isConstantMode) {
          const tiptapContent = stringToTiptap(content)
          editor.commands.setContent(tiptapContent)
        }
        // Update ref and call onChange immediately for programmatic changes
        if (contentRef.current !== content && onContentChangeRef.current) {
          contentRef.current = content
          onContentChangeRef.current(content)
        }
      }
    },
    [editor, isConstantMode, stringContent]
  )

  // Get current tags used in content - memoized
  const usedTags = useMemo(() => {
    if (!editor) return []
    return extractVarIds(editor.getJSON())
  }, [editor, stringContent]) // Dependencies optimized

  // Validate current string content - memoized
  const validation = useMemo(() => {
    return validateTagPattern(stringContent)
  }, [stringContent])

  // Flush any pending debounced calls
  const flushPendingChanges = useCallback(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
      // Get fresh content from editor instead of stale stringContent state
      const currentContent = editor ? tiptapToString(editor.getJSON()) : stringContent
      if (contentRef.current !== currentContent && onContentChangeRef.current) {
        contentRef.current = currentContent
        onContentChangeRef.current(currentContent)
      }
    }
  }, [editor, stringContent])

  return {
    // Editor instance
    editor,

    // Content state
    stringContent,
    isConstantMode,
    usedTags,
    validation,

    // Actions
    insertTag,
    // replaceSelectionWithTag,
    // toggleMode,
    applyStringContent,
    updateStringContent,
    setContent,
    flushPendingChanges,
    isFocused,
    // Utilities
    // tagDataMap,
    // availableTags,

    // Performance utilities
    debounceMs,
    blurDebounceMs,
  }
}

// Simplified hook for basic usage
// export const useSimpleTiptapTags = (
//   initialContent = '',
//   onContentChange?: (content: string) => void,
//   options?: { debounceMs?: number; onBlur?: (content: string) => void }
// ) => {
//   return useTiptapTags({
//     initialContent,
//     onContentChange,
//     onBlur: options?.onBlur,
//     debounceMs: options?.debounceMs,
//   })
// }
