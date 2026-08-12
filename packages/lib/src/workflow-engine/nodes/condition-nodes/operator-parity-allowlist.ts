// packages/lib/src/workflow-engine/nodes/condition-nodes/operator-parity-allowlist.ts

/**
 * Known-broken entries for the workflow **operator** parity suite
 * (`operator-parity.test.ts`, colocated).
 *
 * NOTE ON LOCATION: this is a plain data module, not a test. It sits beside the
 * suite rather than in a `__tests__` directory because both vitest projects
 * glob every `.ts` under a `__tests__` directory as a suite — a helper file
 * there is collected as a suite with no tests and fails the whole run.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The parity suite asserts that everything the builder OFFERS the engine
 * actually DISPATCHES. It was landed against a codebase that had already
 * drifted, so it would have been red on commit. Rather than weaken the
 * assertion, the drift is enumerated here — explicitly, one line of reason per
 * entry — so the suite is green today and every NEW drift is a hard failure.
 *
 * ── HOW TO BURN IT DOWN ─────────────────────────────────────────────────────
 * Fix the drift, delete the line. The suite fails on a STALE entry too
 * ("unexpectedly passing"), so a fixed bug forces its own allowlist removal
 * instead of quietly accumulating.
 *
 * ── HOW TO REGENERATE ───────────────────────────────────────────────────────
 * One command. It prints the current failure set as a copy-pasteable object
 * literal; paste it over `KNOWN_BROKEN_OPERATORS` and fill in the reasons.
 *
 *     cd packages/lib && \
 *       WORKFLOW_PARITY_PRINT_ALLOWLIST=1 pnpm exec vitest run \
 *       src/workflow-engine/nodes/condition-nodes/operator-parity.test.ts
 *
 * The web half of the suite (output variables + config keys) has its own
 * allowlist — `apps/web/src/components/workflow/parity/contract-drift-allowlist.ts`.
 * It lives there and not here because the builder's declarations are in
 * `apps/web` (tier 5) and `packages/lib` (tier 3) must not import upward.
 */

/**
 * Entry key: `operator:<OPERATOR_DEFINITIONS key>`.
 *
 * An entry means: the operator is offered by the shared condition editor (it is
 * in `OPERATOR_DEFINITIONS`) but the if-else evaluator for its declared
 * `category` has no case for it, so the condition silently evaluates `false`.
 */
export const KNOWN_BROKEN_OPERATORS: Record<string, string> = {
  'operator:this_mailbox':
    'Mail-search scope pseudo-operator (category "equality", supportedTypes []); no if-else case — dead in workflows.',
  'operator:everywhere':
    'Mail-search scope pseudo-operator (category "equality", supportedTypes []); no if-else case — dead in workflows.',
}
