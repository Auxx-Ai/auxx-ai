// apps/web/src/components/workflow/nodes/core/note/editor/extensions.ts

import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TextStyle from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import StarterKit from '@tiptap/starter-kit'
import { FontSize } from '~/components/editor/extensions/font-size'

/**
 * Get TipTap extensions for the note editor
 */
export const getNoteEditorExtensions = (placeholder: string) => [
  StarterKit.configure({
    // Keep only the features we need. Every other StarterKit extension (bold,
    // italic, strike, bulletList, listItem, paragraph, text, history,
    // hardBreak, dropcursor, gapcursor) stays on at its default configuration —
    // an option key only accepts `false` to disable or an options object to
    // configure, never `true`.
    heading: false,
    blockquote: false,
    codeBlock: false,
    code: false,
    horizontalRule: false,
    orderedList: false,
  }),
  TextStyle,
  FontSize,
  Underline,
  Link.configure({
    openOnClick: false,
    autolink: true,
  }),
  Placeholder.configure({
    placeholder,
    showOnlyWhenEditable: true,
    showOnlyCurrent: true,
  }),
]
