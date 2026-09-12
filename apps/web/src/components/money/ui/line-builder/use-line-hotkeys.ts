// apps/web/src/components/money/ui/line-builder/use-line-hotkeys.ts

import { useLineRowActions } from '~/components/line-grid/hooks/use-line-row-actions'
import type { LineSchema } from './line-values'

/** Row-level action a shortcut triggers on the focused line row. */
export type LineRowAction =
  | 'description'
  | 'category'
  | 'photos'
  | 'optional'
  | 'taxable'
  | 'matchKey'
  | 'glAccount'
  | 'delete'

type UseLineHotkeysOptions = {
  /** The rows container - the same element `useLineNav` listens on. */
  containerRef: React.RefObject<HTMLDivElement | null>
  /**
   * The document's descriptor, which is what each shortcut is gated on.
   *
   * ⚠️ Was a bare `isQuote: boolean` - a leftover the capability refactor never
   * reached, standing in for "supports optional lines". Two more shortcuts would
   * have meant two more booleans threaded through, which is the shape
   * `LINE_SCHEMAS` exists to retire.
   */
  schema: LineSchema
  readOnly: boolean
}

/**
 * Row-action shortcuts for the line grid, companion to use-line-nav.ts's
 * spreadsheet nav:
 *
 * - `Mod+Shift+D` - add/edit description
 * - `Mod+Shift+L` - set/change category
 * - `Mod+Shift+P` - open the line's photo popover
 * - `Mod+Shift+O` - toggle optional (quotes only)
 * - `Mod+Shift+X` - toggle tax exempt
 * - `Mod+Shift+K` - link/change the match key (buy-side lines with one)
 * - `Mod+Shift+G` - set the GL account (buy-side lines with one)
 * - `Mod+Backspace` - delete the row
 *
 * 🛑 A purchase order line's WEIGHT is the one row-menu action with no
 * shortcut, and the omission is deliberate rather than an oversight: every
 * letter that reads as "weight" is unsafe to bind (see the browser-collision
 * notes in `~/components/line-grid/hooks/use-line-row-actions`, which this
 * hook is a thin wrapper over) - a binding that shuts the browser mid-order
 * is worse than no binding, so the menu item stands alone
 * (plans/purchasing/05-receiving-cost-and-corrections.md §5.3).
 *
 * The MECHANISM (resolve the focused row, dispatch a
 * `LINE_ROW_ACTION_EVENT` CustomEvent on its col-0 cell, listened to by
 * `LineNameCellView`/`LinePartCellView` in line-rows.tsx) is generic and
 * lives in the `line-grid` kit; this hook only supplies money's eight
 * bindings and their gates.
 */
export function useLineHotkeys({ containerRef, schema, readOnly }: UseLineHotkeysOptions) {
  useLineRowActions<LineRowAction>({
    containerRef,
    readOnly,
    bindings: [
      { hotkey: 'Mod+Shift+D', action: 'description' },
      { hotkey: 'Mod+Shift+L', action: 'category' },
      { hotkey: 'Mod+Shift+P', action: 'photos' },
      { hotkey: 'Mod+Shift+O', action: 'optional', enabled: schema.capabilities.optional },
      { hotkey: 'Mod+Shift+X', action: 'taxable' },
      // Gated on the ATTRIBUTE rather than a capability flag: a document whose
      // line entity has no match-key relation has nothing for the shortcut to
      // open, and the attribute is the same thing the cell renders the item
      // from.
      {
        hotkey: 'Mod+Shift+K',
        action: 'matchKey',
        enabled: schema.attrs.purchaseOrderLineRecordId !== null,
      },
      { hotkey: 'Mod+Shift+G', action: 'glAccount', enabled: schema.attrs.glAccount !== null },
      { hotkey: 'Mod+Backspace', action: 'delete' },
    ],
  })
}
