// apps/web/src/components/mail/composer-shared/content-empty.ts
'use client'

import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { REFERENCE_PICKER_NODE } from '~/components/editor/inline-picker'

/** Seed ZWSP an open picker chip holds so ProseMirror can keep its cursor. */
const ZWSP = /​/g

/**
 * Selectors for elements that should not steal focus into the editor when the
 * composer body wrapper is clicked. Superset of the email + chat selectors —
 * the extra `[data-recipient-row]` / `.signature-picker-popover` entries are
 * inert in surfaces that don't render those (e.g. chat), so sharing is safe.
 *
 * The toolbar wrapper itself is intentionally NOT listed: chat floats it over
 * the editor's padded bottom, so clicks in the gaps between its buttons must
 * fall through and focus the editor. The actual controls are still covered by
 * the `button` / `[role="button"]` entries above.
 */
export const INTERACTIVE_ELEMENT_SELECTORS = `
  button, a, input, select, textarea,
  [role="button"], [role="option"], [role="combobox"], [role="menuitem"], [role="tab"],
  [data-recipient-row],
  .ProseMirror, [data-radix-popper-content-wrapper], [data-radix-select-trigger],
  .tippy-box, .signature-picker-popover
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

/** Concatenate text content, skipping open picker chips. A chip's text is the
 *  transient `/` or `@` query (plus a seed ZWSP) — not body content. */
function textIgnoringChips(node: JSONContent): string {
  if (node.type === REFERENCE_PICKER_NODE) return ''
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(textIgnoringChips).join('')
}

/**
 * Like {@link isContentEmpty} but ignores any open `/`/`@` picker chip. Use
 * where the chip is expected to be open while measuring emptiness — e.g. the
 * `/` menu deciding whether to offer Compose (empty body) or transform ops.
 * Without this, the chip's seed ZWSP (which `.trim()` doesn't strip) and its
 * in-progress query both read as "content".
 */
export function isBodyEmptyIgnoringChips(editor: Editor | null): boolean {
  if (!editor) return true
  return textIgnoringChips(editor.getJSON()).replace(ZWSP, '').trim() === ''
}
