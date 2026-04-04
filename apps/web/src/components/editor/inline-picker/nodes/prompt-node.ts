// apps/web/src/components/editor/inline-picker/nodes/prompt-node.ts

import { createInlineNode } from '../core/inline-node'
import type { InlineNodeBadgeProps, InlineNodeConfig } from '../types'

/** Node configuration for prompt template inline nodes */
const promptNodeConfig: InlineNodeConfig = {
  type: 'promptTemplate',
  serialize: (id) => `{{prompt:${id}}}`,
}

/**
 * Creates the TipTap node for prompt template badges.
 * Requires a renderBadge function — use createPromptNode() at the call site
 * so the badge component can access React context (hooks).
 */
export function createPromptNode(renderBadge: (props: InlineNodeBadgeProps) => React.ReactNode) {
  return createInlineNode(promptNodeConfig, renderBadge)
}
