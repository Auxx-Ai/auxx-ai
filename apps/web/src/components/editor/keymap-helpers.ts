// apps/web/src/components/editor/keymap-helpers.ts

import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'

/**
 * Walk up from the current selection, find the first ancestor matching
 * `predicate`, and select the range of its content. Used by Mod-A
 * keymaps on contained blocks (codeBlock, callout, panel, table cell)
 * so Cmd+A scopes to the inner content instead of the whole doc.
 */
export const selectAncestorContent = (
  editor: Editor,
  predicate: (node: PMNode) => boolean
): boolean => {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth)
    if (!predicate(node)) continue
    const start = $from.before(depth) + 1
    const end = start + node.content.size
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start, end))
    )
    return true
  }
  return false
}
