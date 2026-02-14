// ~/components/global/editor/editor-context.tsx

import type { Editor } from '@tiptap/react'
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react'

interface EditorContextProps {
  editor: Editor | null
  setEditor: (editor: Editor | null) => void
}

const EditorContext = createContext<EditorContextProps | undefined>(undefined)

export const EditorProvider = ({ children }: { children: ReactNode }) => {
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null)

  // Use useCallback to memoize the setter function if needed, though simple state setters are usually stable
  const setEditor = useCallback((editor: Editor | null) => {
    setEditorInstance(editor)
  }, [])

  return (
    <EditorContext.Provider value={{ editor: editorInstance, setEditor }}>
      {children}
    </EditorContext.Provider>
  )
}

export const useEditorContext = () => {
  const context = useContext(EditorContext)
  if (context === undefined) {
    throw new Error('useEditorContext must be used within an EditorProvider')
  }
  return context
}
