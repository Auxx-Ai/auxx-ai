// apps/web/src/components/editor/inline-picker/hooks/use-slash-command.ts

'use client'

import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createInlinePickerExtension } from '../core/inline-picker-extension'
import type { InlinePickerState } from '../types'

/** Initial closed state */
const initialState: InlinePickerState = {
  isOpen: false,
  query: '',
  range: null,
  clientRect: null,
}

interface UseSlashCommandReturn {
  /** Current suggestion state for rendering picker */
  suggestionState: InlinePickerState
  /** Synchronous ref tracking whether the picker is open — use in callbacks that can't wait for React render */
  isOpenRef: React.RefObject<boolean>
  /** Execute a command at the trigger position. Command receives editor and range to delete `/query` in a single chain. */
  executeCommand: (command: (editor: Editor, range: { from: number; to: number }) => void) => void
  /** Close picker without executing */
  closePicker: () => void
  /** TipTap extension to add to the editor */
  slashCommandExtension: ReturnType<typeof createInlinePickerExtension>
  /** Set the editor ref — call this once the editor is created */
  setEditor: (editor: Editor | null) => void
}

/**
 * Hook for slash command picker integration.
 *
 * Unlike useInlinePicker, this does NOT create an editor — it returns an extension
 * to add to an existing editor. Slash commands execute editor actions (headings, lists, etc.)
 * or insert content (snippets) rather than inserting inline nodes.
 *
 * Call `setEditor` after the editor is created to wire up command execution.
 */
export function useSlashCommand(): UseSlashCommandReturn {
  const [suggestionState, setSuggestionState] = useState<InlinePickerState>(initialState)
  const rangeRef = useRef<{ from: number; to: number } | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const isOpenRef = useRef(false)

  // Track range for command execution
  useEffect(() => {
    rangeRef.current = suggestionState.range
  }, [suggestionState.range])

  // Create the extension (memoized — stable across renders)
  const slashCommandExtension = useMemo(
    () =>
      createInlinePickerExtension({
        type: 'slash-command',
        trigger: '/',
        allowSpaces: true,
        onStateChange: (state) => {
          // Update ref synchronously so onUpdate can check it in the same tick
          isOpenRef.current = state.isOpen
          setSuggestionState(state)
        },
      }),
    []
  )

  // Set the editor ref
  const setEditor = useCallback((editor: Editor | null) => {
    editorRef.current = editor
  }, [])

  // Execute a command at the trigger position
  const executeCommand = useCallback(
    (command: (editor: Editor, range: { from: number; to: number }) => void) => {
      const editor = editorRef.current
      if (!editor || !rangeRef.current) return

      const range = rangeRef.current
      rangeRef.current = null

      // Close ref synchronously before command so onUpdate sees it as closed
      isOpenRef.current = false

      // Pass range to command so deleteRange + action run in a single chain
      command(editor, range)

      setSuggestionState(initialState)
    },
    []
  )

  // Close picker without executing
  const closePicker = useCallback(() => {
    isOpenRef.current = false
    setSuggestionState(initialState)
    editorRef.current?.commands.focus()
  }, [])

  return {
    suggestionState,
    isOpenRef,
    executeCommand,
    closePicker,
    slashCommandExtension,
    setEditor,
  }
}
