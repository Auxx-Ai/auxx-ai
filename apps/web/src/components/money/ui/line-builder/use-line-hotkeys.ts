// apps/web/src/components/money/ui/line-builder/use-line-hotkeys.ts

import { useHotkey } from '@tanstack/react-hotkeys'

/** Row-level action a shortcut triggers on the focused line row. */
export type LineRowAction = 'description' | 'category' | 'optional' | 'taxable' | 'delete'

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
  /** Optional-line shortcut is quote-only (money plan 18 §3). */
  isQuote: boolean
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
 * - `Mod+Shift+O` — toggle optional (quotes only)
 * - `Mod+Shift+X` — toggle tax exempt
 * - `Mod+Backspace` — delete the row
 *
 * Registered once on the rows container (TanStack `target`), so they only
 * fire while focus is inside the grid — the catalog picker portals outside
 * it, so its keys are never hijacked. The acting row is resolved from the
 * focused element's `data-line-row` cell and delivered as a
 * {@link LINE_ROW_ACTION_EVENT} CustomEvent on that row's name cell.
 */
export function useLineHotkeys({ containerRef, isQuote, readOnly }: UseLineHotkeysOptions) {
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
  useHotkey('Mod+Shift+O', () => dispatchAction('optional'), {
    ...options,
    enabled: !readOnly && isQuote,
  })
  useHotkey('Mod+Shift+X', () => dispatchAction('taxable'), options)
  useHotkey('Mod+Backspace', () => dispatchAction('delete'), options)
}
