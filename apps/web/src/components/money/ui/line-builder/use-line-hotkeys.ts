// apps/web/src/components/money/ui/line-builder/use-line-hotkeys.ts

import type { LineKind } from '@auxx/lib/accounting/documents/lines/client'
import { useLineRowActions } from '~/components/line-grid/hooks/use-line-row-actions'

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
  /** The document's line kind, which each shortcut is gated on. */
  kind: LineKind
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
export function useLineHotkeys({ containerRef, kind, readOnly }: UseLineHotkeysOptions) {
  useLineRowActions<LineRowAction>({
    containerRef,
    readOnly,
    bindings: [
      { hotkey: 'Mod+Shift+D', action: 'description' },
      { hotkey: 'Mod+Shift+L', action: 'category' },
      { hotkey: 'Mod+Shift+P', action: 'photos' },
      { hotkey: 'Mod+Shift+O', action: 'optional', enabled: kind.capabilities.optional },
      { hotkey: 'Mod+Shift+X', action: 'taxable' },
      // Gated on the kind carrying the key, the same thing the cell renders the item from.
      {
        hotkey: 'Mod+Shift+K',
        action: 'matchKey',
        enabled: kind.fields.includes('purchaseOrderLineId'),
      },
      { hotkey: 'Mod+Shift+G', action: 'glAccount', enabled: kind.fields.includes('glAccountId') },
      { hotkey: 'Mod+Backspace', action: 'delete' },
    ],
  })
}
