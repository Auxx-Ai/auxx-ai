// apps/web/src/components/editor/components/editor-bubble-item.tsx
import React from 'react'
import { Slot } from 'radix-ui'
import { useCurrentEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

interface EditorBubbleItemProps {
  readonly children: ReactNode
  readonly asChild?: boolean
  readonly onSelect?: (editor: Editor) => void
}

type Props = EditorBubbleItemProps & Omit<ComponentPropsWithoutRef<'div'>, 'onSelect'>

export const EditorBubbleItem: React.FC<Props> = ({ children, asChild, onSelect, ...rest }) => {
  const { editor } = useCurrentEditor()
  const Comp = asChild ? Slot : 'div'

  if (!editor) return null

  return (
    <Comp {...rest} onClick={() => onSelect?.(editor)}>
      {children}
    </Comp>
  )
}

EditorBubbleItem.displayName = 'EditorBubbleItem'

export default EditorBubbleItem
