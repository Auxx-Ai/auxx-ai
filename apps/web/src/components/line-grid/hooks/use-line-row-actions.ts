// apps/web/src/components/line-grid/hooks/use-line-row-actions.ts

// The hotkey MECHANISM behind a line grid's row-action shortcuts, generalized
// out of money's `useLineHotkeys` (line-builder/use-line-hotkeys.ts): resolve
// the focused row, fire a `CustomEvent` on its col-0 cell. What differs per
// consumer is the *list* of bindings and what gates each one - money keeps
// that list (and the gates on its own schema) in its own thin wrapper; the
// return lines card (money/tasks/56 §4.5) will pass its own three.
//
// Uses `@tanstack/react-hotkeys`'s `useHotkeys` (plural) rather than one
// `useHotkey` call per binding: it accepts a plain array, so a caller with a
// variable-length or conditionally-gated binding list never has to worry
// about the rules of hooks.
//
// Browser-collision notes, moved here because they are facts about the
// LETTERS, not about money:
//
// - `Mod+Shift+T` (reopen tab) and `Mod+Shift+C` (DevTools inspect) are
//   browser-reserved, which is why money picked X for tax-eXempt and L
//   (Label) for category rather than the "obvious" letters.
// - `Mod+Shift+P` collides with Firefox's private-window shortcut; Chrome and
//   Safari leave it free, which is an acceptable trade for "photos".
// - `Mod+Shift+K` collides with Firefox's web console, `Mod+Shift+G` with
//   find-previous while a find bar is open - the same order of collision
//   `⇧P` already carries, and both are free in Chrome and Safari.
// - `Mod+Shift+M` was the obvious letter for "match" and is NOT usable:
//   Chrome binds it to profile switching, Firefox to responsive-design mode.
// - `Mod+Shift+W` closes the window in Chrome, Firefox AND Safari, and (in
//   money's case) every other letter that reads as "weight" is already
//   taken - a binding that can shut the browser mid-document is worse than no
//   binding, so that one action has none at all.

import { type RegisterableHotkey, useHotkeys } from '@tanstack/react-hotkeys'
import type { RefObject } from 'react'

/**
 * CustomEvent name carrying a row action's identifier - dispatched on the
 * focused row's col-0 cell, listened to by whatever owns that cell's local
 * state (money's `LineNameCellView` / `LinePartCellView`).
 */
export const LINE_ROW_ACTION_EVENT = 'line-row-action'

/** One hotkey → row-action binding. */
export interface LineRowActionBinding<A extends string> {
  hotkey: RegisterableHotkey
  action: A
  /**
   * Extra gate beyond `readOnly`, e.g. money's optional-toggle shortcut only
   * firing on a document whose schema supports optional lines. Defaults to
   * `true`.
   */
  enabled?: boolean
}

export interface UseLineRowActionsOptions<A extends string> {
  /** The rows container - the same element {@link useLineNav} listens on. */
  containerRef: RefObject<HTMLDivElement | null>
  readOnly: boolean
  bindings: Array<LineRowActionBinding<A>>
}

/**
 * Registers a line grid's row-action shortcuts and dispatches
 * {@link LINE_ROW_ACTION_EVENT} on the focused row's col-0 cell when one
 * fires. Registered on the rows container (TanStack `target`), so bindings
 * only fire while focus is inside the grid - a catalog picker portalled
 * outside it never has its keys hijacked.
 */
export function useLineRowActions<A extends string>({
  containerRef,
  readOnly,
  bindings,
}: UseLineRowActionsOptions<A>): void {
  const dispatch = (action: A) => {
    const cell = document.activeElement?.closest('[data-line-row]')
    // Row + col tags sit on sibling cells of one grid row - the col-0 cell is
    // the row's action owner, whichever column focus is in.
    const col0Cell = cell?.parentElement?.querySelector('[data-line-col="0"]')
    col0Cell?.dispatchEvent(new CustomEvent<A>(LINE_ROW_ACTION_EVENT, { detail: action }))
  }

  useHotkeys(
    bindings.map((binding) => ({
      hotkey: binding.hotkey,
      callback: () => dispatch(binding.action),
      options: { enabled: !readOnly && (binding.enabled ?? true) },
    })),
    { target: containerRef, conflictBehavior: 'allow' }
  )
}
