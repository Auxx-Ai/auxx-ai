// apps/web/src/components/workflow/nodes/core/note/editor/note-toolbar.tsx

import React from 'react'
import { Editor } from '@tiptap/react'
import {
  ColorPicker,
  FontSizeSelector,
  FormattingButton,
  ToolbarDivider,
  OperatorButtons,
  formattingIcons,
} from './toolbar-components'
import { NoteTheme } from '../types'

interface NoteToolbarProps {
  editor: Editor | null
  theme: NoteTheme
  fontSize: number
  showAuthor: boolean
  onThemeChange: (theme: NoteTheme) => void
  onFontSizeChange: (size: number) => void
  onCopy: () => void
  onDuplicate: () => void
  onDelete: () => void
  onShowAuthorChange: (show: boolean) => void
}

export const NoteToolbar: React.FC<NoteToolbarProps> = ({
  editor,
  theme,
  fontSize,
  showAuthor,
  onThemeChange,
  onFontSizeChange,
  onCopy,
  onDuplicate,
  onDelete,
  onShowAuthorChange,
}) => {
  if (!editor) {
    return null
  }

  return (
    <div className="inline-flex items-center rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-sm">
      <ColorPicker theme={theme} onThemeChange={onThemeChange} />
      <ToolbarDivider />
      <FontSizeSelector fontSize={fontSize} onFontSizeChange={onFontSizeChange} />
      <ToolbarDivider />
      <div className="flex items-center space-x-0.5">
        <FormattingButton
          icon={formattingIcons.bold}
          isActive={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          tooltip="Bold"
        />
        <FormattingButton
          icon={formattingIcons.italic}
          isActive={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          tooltip="Italic"
        />
        <FormattingButton
          icon={formattingIcons.strikethrough}
          isActive={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          tooltip="Strikethrough"
        />
        <FormattingButton
          icon={formattingIcons.link}
          isActive={editor.isActive('link')}
          onClick={() => {
            const url = window.prompt('Enter URL')
            if (url) {
              editor.chain().focus().setLink({ href: url }).run()
            }
          }}
          tooltip="Link"
        />
        <FormattingButton
          icon={formattingIcons.bulletList}
          isActive={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          tooltip="Bullet List"
        />
      </div>
      <ToolbarDivider />
      <OperatorButtons
        onCopy={onCopy}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        showAuthor={showAuthor}
        onShowAuthorChange={onShowAuthorChange}
      />
    </div>
  )
}
