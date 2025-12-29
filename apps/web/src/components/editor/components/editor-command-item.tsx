// apps/web/src/components/editor/components/editor-command-item.tsx
import React from 'react'
import { CommandEmpty, CommandItem } from 'cmdk'
import { useCurrentEditor } from '@tiptap/react'
import { useAtomValue } from 'jotai'
import type { ComponentPropsWithoutRef } from 'react'
import type { Editor, Range } from '@tiptap/core'
import { rangeAtom } from '../utils/store'

interface EditorCommandItemProps {
  readonly onCommand: ({ editor, range }: { editor: Editor; range: Range }) => void
}

type Props = EditorCommandItemProps & ComponentPropsWithoutRef<typeof CommandItem>

export const EditorCommandItem: React.FC<Props> = ({ children, onCommand, ...rest }) => {
  const { editor } = useCurrentEditor()
  const range = useAtomValue(rangeAtom)

  if (!editor || !range) return null

  return (
    <CommandItem {...rest} onSelect={() => onCommand({ editor, range })}>
      {children}
    </CommandItem>
  )
}

EditorCommandItem.displayName = 'EditorCommandItem'

export const EditorCommandEmpty = CommandEmpty

export default EditorCommandItem
