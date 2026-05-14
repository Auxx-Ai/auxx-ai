// apps/web/src/components/editor/rich-text/reference-picker-extensions.ts

import { createInlineNode } from '../inline-picker/core/inline-node'
import { ReferencePickerNode } from '../inline-picker/nodes/reference-picker-node'
import { renderReferenceBadge } from './render-reference-badge'

export interface BuildReferencePickerExtensionsOptions {
  /** Called when Enter is pressed inside the open picker chip. */
  onPickerEnter?: () => boolean
  /** Called when ArrowUp/Down is pressed inside the open picker chip. */
  onPickerArrowVertical?: (direction: 1 | -1) => boolean
}

/**
 * The committed inline badge node — id-prefix disambiguates kind
 * (`article:`, `agent:`, `user:`, …). One TipTap node, one badge renderer,
 * shared by every surface that mounts `@`-mentions.
 *
 * `serialize` is the plain-text fallback (renderText / clipboard copy as
 * text). Markdown export goes through `blocksToMd` separately and resolves
 * to `[Title](id)`; this stays as the legacy `@[id]` form so Kopilot
 * composer behavior is unchanged.
 *
 * `pastePattern` accepts BOTH the legacy `@[id]` form and the markdown
 * `[reference](id)` form so docs round-trip cleanly between the composer
 * and the article editor.
 */
const referenceBadgeNode = createInlineNode(
  {
    type: 'reference',
    serialize: (id) => `@[${id}]`,
    pastePattern: {
      pattern: /(?:@\[([^\]]+)\])|(?:\[reference\]\(([^)]+)\))/,
      getId: (match) => (match[1] ?? match[2])!,
    },
  },
  renderReferenceBadge
)

/**
 * Build the TipTap extensions for the inline `@`-mention picker. Returns
 * `[referenceBadgeNode, ReferencePickerNode]` configured with the caller's
 * keyboard callbacks. Mount this in any rich-text editor that wants
 * `@`-mentions.
 */
export function buildReferencePickerExtensions(
  options: BuildReferencePickerExtensionsOptions = {}
) {
  return [
    referenceBadgeNode,
    ReferencePickerNode.configure({
      onEnter: options.onPickerEnter,
      onArrowVertical: options.onPickerArrowVertical,
    }),
  ]
}
