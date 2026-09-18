// apps/web/src/components/accounting/ui/setup-wizard/wizard-step-handle.ts

/** Which way the shell is trying to leave the current page. */
export type WizardLeaveDirection = 'next' | 'back' | 'exit'

/**
 * Imperative handle a wizard page can expose (via `forwardRef`) so the wizard shell can ask it,
 * right before navigating away in any direction, whether it is safe to leave. Pages that write
 * their data immediately on every change do not need one - pages with their own local draft
 * (Period, Opening balances, Costing) register one to save on leave.
 *
 * Deliberately a LOCAL copy of the dispatch wizard's interface rather than an import across
 * feature folders, with one addition: `direction`.
 *
 * 🛑 The direction matters because of the opening-balance rule. "Set up later" and Back must
 * NEVER be refusable - a page that can trap the user has no escape hatch, and dispatch's own
 * page only blocks because a dirty draft implies the user typed something. Opening balances have
 * to block on a condition that can be true on a page the user never touched (the two snapshots
 * disagreeing), so the block is scoped to `next` and both exits stay open.
 */
export interface WizardStepHandle {
  /**
   * Called before Back/Continue/"Set up later" moves off this page. Returns `true` when it is
   * safe to navigate (saving a dirty-but-valid draft as a side effect first); returns `false`
   * to block navigation (e.g. after showing a validation toast) so unsaved, invalid edits are
   * never silently discarded.
   *
   * ⚠️ Only `'next'` may ever be refused. Implementations must return `true` for `'back'` and
   * `'exit'` after doing whatever saving they can.
   *
   * 🛑 May return a PROMISE, and a page whose save is not optimistic must. The shell awaits it
   * before it renders the next page. Pages holding SETTINGS can stay synchronous - `useSettings`
   * patches the local store the moment it fires - but the opening trial balance is a
   * `journal_entry` read behind `ledgerOpening.get`, so a fire-and-forget save let the finalize
   * page mount against the pre-save answer and report "No opening trial balance entered" about
   * the entry just saved (plans/accounting/WIZARD-REVIEW.md F7).
   */
  tryAdvance: (direction: WizardLeaveDirection) => boolean | Promise<boolean>
}

/**
 * Ask the current page's handle whether the shell may leave, and run `onAllowed` only if it says
 * yes and only once it has finished saying so. A page with no handle never refuses - most pages
 * write immediately and have nothing to save.
 *
 * 🛑 The `await` here is load-bearing TWICE over, which is why this orchestration is a tested
 * function rather than three lines inlined in the shell:
 *
 *  1. It is what makes the finalize page read a SAVED trial balance rather than the pre-save one.
 *     `ledgerOpening.get` is a server query with no optimistic update, so advancing before the
 *     save landed made the last page report "No opening trial balance entered" about the entry
 *     that had just been saved (plans/accounting/WIZARD-REVIEW.md F7).
 *  2. `tryAdvance` may return a PROMISE, and `if (somePromise)` is unconditionally true - so
 *     dropping the await would make every refusal pass, including the unbalanced opening trial
 *     balance, the one page where walking past it is unrecoverable.
 */
export async function leaveCurrentPage(
  handle: WizardStepHandle | null,
  direction: WizardLeaveDirection,
  onAllowed: () => void
): Promise<void> {
  const allowed = handle ? await handle.tryAdvance(direction) : true
  if (allowed) onAllowed()
}
