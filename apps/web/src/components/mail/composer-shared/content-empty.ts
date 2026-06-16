// apps/web/src/components/mail/composer-shared/content-empty.ts
'use client'

import type { Editor } from '@tiptap/react'

/**
 * Selectors for elements that should not steal focus into the editor when the
 * composer body wrapper is clicked. Superset of the email + chat selectors —
 * the extra `[data-recipient-row]` / `.signature-picker-popover` entries are
 * inert in surfaces that don't render those (e.g. chat), so sharing is safe.
 */
export const INTERACTIVE_ELEMENT_SELECTORS = `
  button, a, input, select, textarea,
  [role="button"], [role="option"], [role="combobox"], [role="menuitem"], [role="tab"],
  [data-recipient-row],
  .ProseMirror, [data-radix-popper-content-wrapper], [data-radix-select-trigger],
  .tippy-box, .editor-toolbar-wrapper, .signature-picker-popover
`.trim()

/**
 * Check if editor content is effectively empty (no text, only empty blocks).
 * Schema-agnostic: `getText()` ignores markup, so empty paragraphs / headings /
 * lists all read as empty without an HTML-regex check.
 */
export function isContentEmpty(editor: Editor | null): boolean {
  if (!editor) return true
  return (editor.getText()?.trim() ?? '') === ''
}
