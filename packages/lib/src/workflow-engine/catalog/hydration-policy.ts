// packages/lib/src/workflow-engine/catalog/hydration-policy.ts

import type { DehydrateGraphOptions, HydrateGraphOptions } from './graph-hydration'

/**
 * How every wired seam calls {@link hydrateGraph} / {@link dehydrateGraph} —
 * one constant so the two halves can never disagree, and so the decision below
 * has exactly one place to be reversed.
 *
 * ## Why the read-time defaults layer is OFF
 *
 * `plans/kopilot/workflow/23-graph-document-canonicalization.md` §2.4 wants
 * `manifest.defaultData()` layered under stored data at read, so a default is a
 * projection rather than a panel write. The hydrator implements it; this
 * rollout does not turn it on, for three reasons:
 *
 * 1. **It is not behaviour-neutral, and §6 phase 1 depends on that.** The read
 *    side ships before the write side precisely because hydration is a no-op
 *    against today's documents. With defaults layered it is not: a legacy `ai`
 *    or `crud` node carrying no `error_strategy` gains one, and
 *    `WorkflowGraphBuilder.getNodeHandles` then registers a `fail` handle the
 *    node never had — changing fork/join accounting on stored workflows.
 * 2. **The inverse of the layer deletes load-bearing stored keys.**
 *    `resource-trigger`'s `defaultData()` is `operation: 'created'`, so
 *    dehydration would strip `operation` from every stored resource trigger —
 *    and `deriveTriggerColumns`, which runs inside `persistDraft` over the
 *    CLEANED graph, sets `Workflow.triggerType`/`entityDefinitionId` only when
 *    BOTH `operation` and `entityDefinitionId` are present. The column would
 *    fall back to `'resource-trigger'`, which no dispatcher matches, and every
 *    resource-triggered workflow would silently stop firing. The same shape of
 *    hazard applies to any server-side derivation that reads the stored column
 *    without hydrating — and there are several.
 * 3. **Its beneficiaries are not in this change.** §2.4 exists to retire the
 *    resource-trigger and app-node panel backfills, which live in `apps/web`.
 *    Shipping the layer without them changes behaviour for no payoff.
 *
 * Turning it on is therefore its own step: retire the panel backfills, make
 * every stored-column derivation hydrate first, and re-run the §6 invariants.
 */
export const HYDRATION_OPTIONS: HydrateGraphOptions = { skipDefaults: true }

/** The write-side mirror of {@link HYDRATION_OPTIONS} — the two MUST stay symmetric. */
export const DEHYDRATION_OPTIONS: DehydrateGraphOptions = { skipDefaults: true }
