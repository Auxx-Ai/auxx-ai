// apps/web/src/components/global/token-field/token-source.ts

import type React from 'react'

/**
 * The single seam that varies between token-field consumers — the leaner cousin
 * of {@link CalcTokenSource} (no functions: a URL/header/param value is a value,
 * not a formula). A *token source* is the whole of what a `{token}` means: how its
 * chip renders, and how the `{`-picker lists selectable tokens.
 *
 * The first consumer is data-connectors webhook steering, where tokens are the
 * declared payload `{path}` placeholders.
 */
export interface TokenSource {
  /** Render a token chip from its serialized id (the `{id}` payload). */
  renderBadge: (id: string, selected: boolean) => React.ReactNode
  /**
   * The full `{` picker popover body — must be Command-rooted (the popover
   * provides no Command context). `onSelect(tokenId)` inserts the token;
   * `onClose` dismisses the picker.
   */
  renderPickerItems: (ctx: {
    query: string
    onSelect: (tokenId: string) => void
    onClose: () => void
  }) => React.ReactNode
}
