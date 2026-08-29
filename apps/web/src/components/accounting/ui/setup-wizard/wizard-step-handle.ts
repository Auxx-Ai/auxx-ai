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
   */
  tryAdvance: (direction: WizardLeaveDirection) => boolean
}
