// apps/web/src/components/workflow/nodes/core/loop/constants.ts

// LOOP_CONSTANTS and LOOP_HANDLES moved to the node catalog with loop's data
// half (node-catalog Phase 1 — `@auxx/lib/workflow-engine/catalog/nodes/loop`);
// re-exported here so no web import churns.
export { LOOP_CONSTANTS, LOOP_HANDLES } from '@auxx/lib/workflow-engine/client'

/**
 * Builder-only loop variable vocabulary.
 *
 * ⚠ Known drift (re-verification 2026-08-12): the ENGINE writes the bare
 * `index` and node-scoped `<loopNodeId>.item`/`.index`/… keys — nothing in the
 * engine writes these `loop.*` names (only the single-node-run hook seeds
 * them). Deliberately NOT moved to the catalog until that drift is resolved;
 * agent-facing guidance teaches node-scoped refs only.
 */
export const LOOP_VARIABLES = {
  INDEX: 'loop.index',
  COUNT: 'loop.count',
  TOTAL: 'loop.total',
  ITEM: 'loop.item',
  IS_FIRST: 'loop.isFirst',
  IS_LAST: 'loop.isLast',
  RESULTS: 'loop.results',
} as const
