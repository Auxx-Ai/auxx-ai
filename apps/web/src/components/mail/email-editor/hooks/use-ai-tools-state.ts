// apps/web/src/components/mail/email-editor/hooks/use-ai-tools-state.ts
'use client'

import { useState, useCallback } from 'react'
import type { Editor } from '@tiptap/react'

export interface AIToolsState {
  isProcessing: boolean
  currentOperation: string | null
  history: ContentHistory[]
  currentHistoryIndex: number
  error: string | null
}

interface ContentHistory {
  content: string
  format: 'html' | 'tiptap'
  operation: string | null
  timestamp: number
}

/**
 * Hook for managing AI tools state including history, undo/redo functionality
 */
export function useAIToolsState(editor: Editor | null) {
  const [state, setState] = useState<AIToolsState>({
    isProcessing: false,
    currentOperation: null,
    history: [],
    currentHistoryIndex: -1,
    error: null,
  })

  /**
   * Add content to history
   */
  const pushToHistory = useCallback((content: string, operation?: string | null) => {
    setState((prev) => {
      // Remove any redo history when new change is made
      const newHistory = prev.history.slice(0, prev.currentHistoryIndex + 1)
      
      // Limit history size to prevent memory issues
      const MAX_HISTORY_SIZE = 20
      if (newHistory.length >= MAX_HISTORY_SIZE) {
        newHistory.shift() // Remove oldest
      }
      
      newHistory.push({
        content,
        format: 'html',
        operation: operation ?? prev.currentOperation,
        timestamp: Date.now(),
      })

      return {
        ...prev,
        history: newHistory,
        currentHistoryIndex: newHistory.length - 1,
      }
    })
  }, [])

  /**
   * Undo functionality - go back to previous state
   */
  const undo = useCallback(() => {
    setState((prev) => {
      if (prev.currentHistoryIndex > 0) {
        const newIndex = prev.currentHistoryIndex - 1
        const previousContent = prev.history[newIndex]

        // Apply to editor
        if (editor && previousContent) {
          editor.commands.setContent(previousContent.content)
        }

        return {
          ...prev,
          currentHistoryIndex: newIndex,
        }
      }
      return prev
    })
  }, [editor])

  /**
   * Redo functionality - go forward to next state
   */
  const redo = useCallback(() => {
    setState((prev) => {
      if (prev.currentHistoryIndex < prev.history.length - 1) {
        const newIndex = prev.currentHistoryIndex + 1
        const nextContent = prev.history[newIndex]

        // Apply to editor
        if (editor && nextContent) {
          editor.commands.setContent(nextContent.content)
        }

        return {
          ...prev,
          currentHistoryIndex: newIndex,
        }
      }
      return prev
    })
  }, [editor])

  /**
   * Set processing state
   */
  const setProcessing = useCallback((processing: boolean) => {
    setState((prev) => ({ ...prev, isProcessing: processing }))
  }, [])

  /**
   * Set current operation
   */
  const setCurrentOperation = useCallback((operation: string | null) => {
    setState((prev) => ({ ...prev, currentOperation: operation }))
  }, [])

  /**
   * Set error state
   */
  const setError = useCallback((error: string | null) => {
    setState((prev) => ({ ...prev, error }))
  }, [])

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }))
  }, [])

  // Computed values
  const canUndo = state.currentHistoryIndex > 0
  const canRedo = state.currentHistoryIndex < state.history.length - 1

  return {
    state,
    pushToHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    setProcessing,
    setCurrentOperation,
    setError,
    clearError,
  }
}