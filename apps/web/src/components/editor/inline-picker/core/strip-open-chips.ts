// apps/web/src/components/editor/inline-picker/core/strip-open-chips.ts

import type { JSONContent } from '@tiptap/core'
import { REFERENCE_PICKER_NODE } from '../nodes/reference-picker-node'

const ZWSP_RE = /​/g

/**
 * Replace any open picker chip in a TipTap JSON doc with its literal text
 * (`@query` / `/half-typed`) — exactly what Escape would leave behind.
 *
 * The chip node is transient (an open picker), so the JSON handed to
 * `onChange` / autosave must never contain it: a doc saved mid-typing reads
 * back as what was on screen, and the server echo of that save compares
 * equal to what we emitted (echo detection in `useExternalContentSync` keys
 * off this exact JSON).
 *
 * Returns the input object untouched (same reference) when no chip is
 * present, so callers' identity checks stay cheap.
 */
export function stripOpenChips(json: JSONContent): JSONContent {
  if (!containsChip(json)) return json
  return stripNode(json) ?? { ...json, content: [] }
}

function containsChip(node: JSONContent): boolean {
  if (node.type === REFERENCE_PICKER_NODE) return true
  return node.content?.some(containsChip) ?? false
}

function stripNode(node: JSONContent): JSONContent | null {
  if (node.type === REFERENCE_PICKER_NODE) {
    const trigger = (node.attrs?.trigger as string) ?? '@'
    const query = (node.content ?? [])
      .map((child) => child.text ?? '')
      .join('')
      .replace(ZWSP_RE, '')
    // Literal text node — an empty query still leaves the bare trigger char,
    // matching what the user sees on screen.
    return { type: 'text', text: `${trigger}${query}` }
  }
  if (!node.content) return node
  return { ...node, content: node.content.map(stripNode).filter((n): n is JSONContent => !!n) }
}
