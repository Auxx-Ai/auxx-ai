import type { EditorProviderProps, JSONContent } from '@tiptap/react'
import { EditorProvider } from '@tiptap/react'
import { Provider } from 'jotai'
import type { FC, ReactNode } from 'react'
import { useRef } from 'react'
import { auxxEditorStore } from '../utils/store'
import tunnel from '../utils/tunnel'
import { EditorCommandTunnelContext } from './editor-command'

export interface EditorProps {
  readonly children: ReactNode
  readonly className?: string
}

interface EditorRootProps {
  readonly children: ReactNode
}
export const EditorRoot: FC<EditorRootProps> = ({ children }) => {
  const tunnelInstance = useRef(tunnel()).current

  return (
    <Provider store={auxxEditorStore}>
      <EditorCommandTunnelContext.Provider value={tunnelInstance}>
        {children}
      </EditorCommandTunnelContext.Provider>
    </Provider>
  )
}

export type EditorContentProps = Omit<EditorProviderProps, 'content'> & {
  readonly children?: ReactNode
  readonly className?: string
  readonly initialContent?: JSONContent
}

// React 19: forwardRef is deprecated; accept no ref and render directly
export function EditorContent({
  className,
  children,
  initialContent,
  ...rest
}: EditorContentProps) {
  return (
    <div className={className}>
      <EditorProvider {...rest} content={initialContent}>
        {children}
      </EditorProvider>
    </div>
  )
}

EditorContent.displayName = 'EditorContent'
