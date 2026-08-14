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
 * Surface: §2 reference resolution (`refs.ts`), §3 normalization
 * (`normalize/`), §1 operations (`ops.ts` writes + `read.ts` reads), §4
 * layout/placement, §5 validation. The Redis turn snapshot, realtime event
 * and `runNode` land in the next slice and wrap `persistDraft`.
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
  type AddNodeInput,
  type ApplyTemplateInput,
  addNode,
  applyTemplate,
  type ConnectNodesInput,
  connectNodes,
  type DeleteNodesInput,
  type DisconnectNodesInput,
  deleteNodes,
  disconnectNodes,
  type ReplaceGraphEdgeSpec,
  type ReplaceGraphInput,
  type ReplaceGraphNodeSpec,
  replaceGraph,
  type SetTriggerInput,
  setTrigger,
  type UpdateNodeInput,
  updateNode,
} from './ops'
export {
  cleanGraphForSave,
  type PersistDraftInput,
  type PersistDraftOutcome,
  persistDraft,
} from './persist'
export {
  DEFAULT_NODE_SIZE,
  findNearestEmptySpace,
  type InsidePlacement,
  isPositionOccupied,
  placeAfter,
  placeInside,
  placeStandalone,
  type Size,
} from './place-node'
export {
  buildGraphSummary,
  buildNodeSummary,
  type DraftContext,
  type GraphEditScope,
  loadDraftContext,
  readDraft,
  renderFriendlyOutputs,
  validateWorkflow,
  type WorkflowValidationReport,
} from './read'
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
  DraftGraph,
  DraftSummary,
  EdgeMeta,
  EdgeSummary,
  GraphEdge,
  GraphMutationResult,
  GraphNode,
  GraphSummary,
  Issue,
  IssueSeverity,
  NodeMeta,
  NodeRef,
  NodeSummary,
  Point,
  RefCorrection,
  ResolvedNodeRef,
  WorkflowOutputGraph,
} from './types'
export {
  hasBlockingIssues,
  isTriggerNode,
  nodeType,
  validateGraphStructure,
  validateNodeConfigs,
} from './validate'
