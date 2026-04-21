// apps/web/src/components/editor/inline-picker/nodes/placeholder-node.ts

import { createInlineNode } from '../core/inline-node'
import type { InlineNodeBadgeProps, InlineNodeConfig } from '../types'

// Matches a placeholder token body — fieldRefKey (containing `:` / `::`) or
// `date:<slug>`. Stops at whitespace or the closing `}`.
const TOKEN_BODY = /[^\s{}]+/
const INPUT_RULE = new RegExp(String.raw`\{\{(${TOKEN_BODY.source})\}\}$`)
const PASTE_PATTERN = new RegExp(String.raw`\{\{(${TOKEN_BODY.source})\}\}`, 'g')

const placeholderNodeConfig: InlineNodeConfig = {
  type: 'placeholder',
  serialize: (id) => `{{${id}}}`,
  inputRules: [
    {
      find: INPUT_RULE,
      getId: (m) => {
        const id = m[1]
        if (!id) throw new Error('placeholder input rule matched without id')
        return id
      },
    },
  ],
  pastePattern: {
    pattern: PASTE_PATTERN,
    getId: (m) => {
      const id = m[1]
      if (!id) throw new Error('placeholder paste pattern matched without id')
      return id
    },
  },
}

/**
 * Creates the TipTap node for placeholder badges.
 * Requires a renderBadge function — call createPlaceholderNode() at the call
 * site so the badge component can access React context (hooks).
 */
export function createPlaceholderNode(
  renderBadge: (props: InlineNodeBadgeProps) => React.ReactNode
) {
  return createInlineNode(placeholderNodeConfig, renderBadge)
}
