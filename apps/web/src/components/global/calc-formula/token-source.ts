// apps/web/src/components/global/calc-formula/token-source.ts

import type React from 'react'

/**
 * The single seam that varies between calc-formula consumers (custom-fields vs
 * data-connectors). A *token source* is the whole of what a `{token}` means: how
 * its chip renders, how the `{`-picker lists selectable tokens, and a human
 * label for the "tokens used" strip.
 *
 * - custom-fields builds one from an entity definition (tokens = field keys).
 * - data-connectors builds one from a source schema (tokens = source paths).
 *
 * Adding a future consumer is implementing this interface, not rewiring props.
 */
export interface CalcTokenSource {
  /** Render a token chip from its serialized id (the `{id}` payload). */
  renderBadge: (id: string, selected: boolean) => React.ReactNode
  /**
   * The full `{` picker popover body — must be Command-rooted (the popover
   * provides no Command context). Render the token list plus the shared
   * `<FunctionsPickerGroup onSelect={insertFunction} />` wherever it fits the
   * widget (a self-contained field picker nests it via its own slot; a flat
   * source list renders it as a sibling group). `onSelect(tokenId)` inserts the
   * token; `insertFunction(name)` inserts a function call; `onClose` dismisses.
   */
  renderPickerItems: (ctx: {
    query: string
    onSelect: (tokenId: string) => void
    insertFunction: (funcName: string) => void
    onClose: () => void
  }) => React.ReactNode
}
