// packages/lib/src/workflows/graph-edit/types.ts

/**
 * Shared types for the headless graph-edit module — the friendly-input layer
 * agent tools and other headless callers use to edit a workflow draft.
 *
 * Graph shapes are REUSED from the catalog rather than re-declared:
 * `NodeMeta`/`EdgeMeta` (`workflow-engine/catalog/graph-vars.ts`) are the
 * structural node/edge representation React Flow nodes, engine nodes and
 * agent-authored graphs all satisfy, and `WorkflowOutputGraph`
 * (`workflow-engine/catalog/resolve-outputs.ts`) is the persisted-graph shape
 * output resolution reads. Type-only re-exports keep this file browser-safe
 * even though `resolve-outputs.ts` itself is server-only.
 */

import type { EdgeMeta, NodeMeta } from '../../workflow-engine/catalog/graph-vars'
import type { WorkflowOutputGraph } from '../../workflow-engine/catalog/resolve-outputs'

export type { EdgeMeta, NodeMeta, WorkflowOutputGraph }

/** How loud an issue is. Blocking-vs-non-blocking is pipeline policy, not encoded here. */
export type IssueSeverity = 'error' | 'warning' | 'info'

/**
 * One validation/normalization finding, returned alongside (never instead of)
 * the operation result. The shape from `03-graph-edit-service.md` §5, plus two
 * optional machine-readable fields so a caller can auto-apply corrections.
 */
export interface Issue {
  severity: IssueSeverity
  /**
   * Friendly reference to the node the issue is about — the title when unique,
   * the node id otherwise (`formatNodeRef`). Never a raw id when a unique
   * title exists, so a model can echo it back as a valid ref.
   */
  nodeRef?: string
  /** Config field the issue is about (e.g. `resourceType`, `prompt_template.0.role`). */
  field?: string
  /** The offending variable reference, verbatim, when the issue is about one. */
  ref?: string
  message: string
  /** Machine-usable corrected form (e.g. `att.values[*].name` for `att[*].name`). */
  suggestion?: string
}

/**
 * A node reference as tools accept it: a node *title* (matched exactly,
 * case-insensitively) or a node id. See `refs.ts` for resolution rules.
 */
export type NodeRef = string

/** A successfully resolved node reference. */
export interface ResolvedNodeRef {
  node: NodeMeta
  matchedBy: 'title' | 'id'
}

/** A ref-level correction the caller may apply verbatim (`from` → `to`). */
export interface RefCorrection {
  /** Node whose data holds the reference. */
  nodeId: string
  /** The reference as written (the raw path inside `{{…}}`, or the bare ref). */
  from: string
  /** The corrected reference. */
  to: string
}
