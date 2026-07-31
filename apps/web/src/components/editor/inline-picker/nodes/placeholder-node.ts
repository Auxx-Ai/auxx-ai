// apps/web/src/components/editor/inline-picker/nodes/placeholder-node.ts

import {
  decodeFallback,
  decodePlaceholderFormat,
  encodeFallback,
  encodePlaceholderFormat,
} from '@auxx/lib/placeholders/client'
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
  extraAttrs: {
    fallback: {
      default: null,
      dataAttr: 'data-fallback',
      // The node attribute is `unknown` at the framework boundary (it comes
      // straight off `node.attrs`), so re-validate through the decoder rather
      // than handing raw attr state to `encodeFallback`. A payload the codec
      // rejects serializes to '' instead of round-tripping malformed JSON
      // back into the document HTML.
      serialize: (value) => {
        const payload = decodeFallback(JSON.stringify(value))
        return payload ? encodeFallback(payload) : ''
      },
      parse: decodeFallback,
    },
    format: {
      default: null,
      dataAttr: 'data-format',
      // Same boundary revalidation as `fallback` above.
      serialize: (value) => {
        const payload = decodePlaceholderFormat(JSON.stringify(value))
        return payload ? encodePlaceholderFormat(payload) : ''
      },
      parse: decodePlaceholderFormat,
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
