// apps/web/src/components/editor/kb-article/kb-article-editor.tsx
'use client'

import type { JSONContent } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import type { CSSProperties } from 'react'
import { InlinePickerPopover } from '../inline-picker'
import styles from './kb-article-editor.module.css'
import { KBSlashCommandPicker } from './kb-slash-command-picker'
import { useKBArticleEditor } from './use-kb-article-editor'

interface KBArticleEditorProps {
  initialContent: JSONContent | null
  onChange: (content: { json: JSONContent; html: string }) => void
}

export function KBArticleEditor({ initialContent, onChange }: KBArticleEditorProps) {
  const { editor, gutterCharWidth, slashCommand } = useKBArticleEditor({
    initialContent,
    onChange,
  })

  // Clicks on chrome around the contenteditable (padding, empty area below
  // the last block) should still focus the editor at end — matches the
  // behavior people expect from doc editors.
  const handleWrapperMouseDown = (e: React.MouseEvent) => {
    if (!editor || editor.isDestroyed) return
    const target = e.target as HTMLElement
    if (target.closest('.ProseMirror')) return
    if (target.closest('[data-block-drag-handle]')) return
    e.preventDefault()
    editor.commands.focus('end')
  }

  return (
    <div
      className={styles.editorWrapper}
      onMouseDown={handleWrapperMouseDown}
      style={{ '--gutter-min-width': `calc(${gutterCharWidth}ch + 1rem)` } as CSSProperties}>
      <div className={styles.editorContainer}>
        <EditorContent editor={editor} className={styles.editorContent} />
      </div>
      <InlinePickerPopover
        state={slashCommand.suggestionState}
        onClose={slashCommand.closePicker}
        width={288}>
        <KBSlashCommandPicker
          query={slashCommand.suggestionState.query}
          onExecute={slashCommand.executeCommand}
          onClose={slashCommand.closePicker}
        />
      </InlinePickerPopover>
    </div>
  )
}
