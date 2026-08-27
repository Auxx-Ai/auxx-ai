// apps/web/src/components/money/ui/line-builder/use-line-hotkeys.ts

import { useHotkey } from '@tanstack/react-hotkeys'
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

/**
 * CustomEvent name carrying a {@link LineRowAction} — dispatched by
 * {@link useLineHotkeys} on the focused row's name cell, listened to by
 * `LineNameCellView` (line-rows.tsx), which owns the row-local state the
 * actions drive (description editor, category menu).
 */
export const LINE_ROW_ACTION_EVENT = 'line-row-action'

type UseLineHotkeysOptions = {
  /** The rows container — the same element `useLineNav` listens on. */
  containerRef: React.RefObject<HTMLDivElement | null>
  /**
   * The document's descriptor, which is what each shortcut is gated on.
   *
   * ⚠️ Was a bare `isQuote: boolean` — a leftover the capability refactor never
   * reached, standing in for "supports optional lines". Two more shortcuts would
   * have meant two more booleans threaded through, which is the shape
   * `LINE_SCHEMAS` exists to retire.
   */
  schema: LineSchema
  readOnly: boolean
}

/**
 * Row-action shortcuts for the line grid, companion to use-line-nav.ts's
 * spreadsheet nav. Focus always sits inside a cell `<input>`, so every
 * binding is modifier-based (bare letters would type); `Mod+Shift+T`
 * (reopen tab) and `Mod+Shift+C` (DevTools inspect) are browser-reserved,
 * hence X for tax-eXempt and L (Label) for category:
 *
 * - `Mod+Shift+D` — add/edit description
 * - `Mod+Shift+L` — set/change category
 * - `Mod+Shift+P` — open the line's photo popover (`Mod+Shift+P` is Firefox's
 *   private-window shortcut; Chrome/Safari leave it free, acceptable)
 * - `Mod+Shift+O` — toggle optional (quotes only)
 * - `Mod+Shift+X` — toggle tax exempt
 * - `Mod+Shift+K` — link/change the match key (buy-side lines with one)
 * - `Mod+Shift+G` — set the GL account (buy-side lines with one)
 * - `Mod+Backspace` — delete the row
 *
 * ⚠️ The two additions collide with Firefox's web console (`⇧K`) and with
 * find-previous while a find bar is open (`⇧G`) — the same order of collision
 * `⇧P` already carries, and both are free in Chrome and Safari. `⇧M` was the
 * obvious letter for "match" and is NOT usable: Chrome binds it to profile
 * switching and Firefox to responsive-design mode.
 *
 * Registered once on the rows container (TanStack `target`), so they only
 * fire while focus is inside the grid — the catalog picker portals outside
 * it, so its keys are never hijacked. The acting row is resolved from the
 * focused element's `data-line-row` cell and delivered as a
 * {@link LINE_ROW_ACTION_EVENT} CustomEvent on that row's name cell.
 */
export function useLineHotkeys({ containerRef, schema, readOnly }: UseLineHotkeysOptions) {
  const dispatchAction = (action: LineRowAction) => {
    const cell = document.activeElement?.closest('[data-line-row]')
    // Row + col tags sit on sibling cells of one grid row — the name cell
    // (col 0) is the row's action owner, whichever column focus is in.
    const nameCell = cell?.parentElement?.querySelector('[data-line-col="0"]')
    nameCell?.dispatchEvent(
      new CustomEvent<LineRowAction>(LINE_ROW_ACTION_EVENT, { detail: action })
    )
  }

  const options = {
    enabled: !readOnly,
    target: containerRef,
    conflictBehavior: 'allow',
  } as const

  useHotkey('Mod+Shift+D', () => dispatchAction('description'), options)
  useHotkey('Mod+Shift+L', () => dispatchAction('category'), options)
  useHotkey('Mod+Shift+P', () => dispatchAction('photos'), options)
  useHotkey('Mod+Shift+O', () => dispatchAction('optional'), {
    ...options,
    enabled: !readOnly && schema.capabilities.optional,
  })
  useHotkey('Mod+Shift+X', () => dispatchAction('taxable'), options)
  // Gated on the ATTRIBUTE rather than a capability flag: a document whose line
  // entity has no match-key relation has nothing for the shortcut to open, and
  // the attribute is the same thing the cell renders the item from.
  useHotkey('Mod+Shift+K', () => dispatchAction('matchKey'), {
    ...options,
    enabled: !readOnly && schema.attrs.purchaseOrderLineRecordId !== null,
  })
  useHotkey('Mod+Shift+G', () => dispatchAction('glAccount'), {
    ...options,
    enabled: !readOnly && schema.attrs.glAccount !== null,
  })
  useHotkey('Mod+Backspace', () => dispatchAction('delete'), options)
}
