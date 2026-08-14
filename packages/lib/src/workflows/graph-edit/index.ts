// packages/lib/src/workflows/graph-edit/index.ts

/**
 * Headless graph-edit module (`plans/kopilot/workflow/03-graph-edit-service.md`)
 * — friendly input in, validated graph + resolved outputs out. SERVER-ONLY
 * entrypoint: `resource-refs.ts` and `ref-check.ts` read the org cache, so this
 * barrel must never be exported through a client bundle (same rule as the
 * catalog's `build-output-context.ts`/`resolve-outputs.ts` leaf subpaths).
 * The pure pieces (`refs.ts`, `normalize/friendly-refs.ts`,
 * `normalize/prompt.ts`, `normalize/connection.ts`) are browser-safe and can
 * grow a dedicated client surface when a UI consumer appears.
 *
 * This file exports the §2 (reference resolution) + §3 (friendly → persisted
 * normalization) surface; the mutation ops, pipeline and layout land in their
 * own slices and extend these exports.
 */

export {
  type ConnectionSpec,
  resolveConnectionSpec,
} from './normalize/connection'
export {
  type FriendlyRefsResult,
  normalizeFriendlyRefs,
  type ResourceAliasIndex,
  renderPersistedRefs,
} from './normalize/friendly-refs'
export { normalizeAiPromptConfig } from './normalize/prompt'
export {
  checkGraphRefs,
  checkVariableRefsAgainstOutputs,
  type RefCheckResult,
} from './normalize/ref-check'
export {
  buildResourceAliasIndex,
  normalizeResourceConfig,
  RESOURCE_CONFIG_KEYS,
  resolveResourceRef,
} from './normalize/resource-refs'
export {
  closestMatches,
  describeNode,
  formatNodeRef,
  isIdShaped,
  matchNodeRefPrefix,
  type NodeRefPrefixMatch,
  nodeTitle,
  resolveNodeRef,
} from './refs'
export type {
  EdgeMeta,
  Issue,
  IssueSeverity,
  NodeMeta,
  NodeRef,
  RefCorrection,
  ResolvedNodeRef,
  WorkflowOutputGraph,
} from './types'
