// apps/web/src/components/dispatch/ui/setup-wizard/wizard-step-handle.ts

/**
 * Imperative handle a wizard page can expose (via `forwardRef`) so the wizard shell can ask it,
 * right before navigating away in any direction, whether it's safe to leave. Pages that write
 * their data immediately on every change (Workers) don't need one — pages with their own local
 * draft (Business address, Operating hours) register one to save on leave.
 */
export interface WizardStepHandle {
  /**
   * Called before Back/Continue/"Set up later" moves off this page. Returns `true` when it's
   * safe to navigate (saving a dirty-but-valid draft as a side effect first); returns `false`
   * to block navigation (e.g. after showing a validation toast) so unsaved, invalid edits are
   * never silently discarded.
   */
  tryAdvance: () => boolean
}
