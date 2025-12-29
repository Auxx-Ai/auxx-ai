// apps/web/src/components/mail/email-editor/editor-active-state-context.tsx
'use client'
import React, { createContext, useContext } from 'react'
import { useEditorActiveState, type UseEditorActiveStateReturn } from './use-editor-active-state'

const EditorActiveStateContext = createContext<UseEditorActiveStateReturn | null>(null)

interface EditorActiveStateProviderProps {
  children: React.ReactNode
}

/**
 * Provider component for editor active state management
 * Wraps the email editor to provide shared focus/active state tracking
 */
export function EditorActiveStateProvider({ children }: EditorActiveStateProviderProps) {
  const activeState = useEditorActiveState()

  return (
    <EditorActiveStateContext.Provider value={activeState}>
      {children}
    </EditorActiveStateContext.Provider>
  )
}

/**
 * Hook to access editor active state context
 * Must be used within EditorActiveStateProvider
 */
export function useEditorActiveStateContext(): UseEditorActiveStateReturn {
  const context = useContext(EditorActiveStateContext)
  
  if (!context) {
    throw new Error('useEditorActiveStateContext must be used within EditorActiveStateProvider')
  }
  
  return context
}