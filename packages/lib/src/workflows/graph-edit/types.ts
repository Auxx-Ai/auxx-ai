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
  /**
   * True when this issue is about a node the current mutation did NOT touch —
   * it was already there and is not a consequence of this edit.
   *
   * Without the distinction a caller re-reads a full issue list after every
   * write and cannot tell "I just caused this" from "this was already here",
   * which is how one agent spent a whole turn chasing three warnings it had
   * already fixed.
   */
  preExisting?: boolean
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

/** Canvas coordinates. */
export interface Point {
  x: number
  y: number
}

/**
 * A persisted graph node as the draft `Workflow.graph` column stores it —
 * `NodeMeta` plus the layout fields the canvas persists. Only the durable
 * contract (`07-remaining-mechanics.md` §0): `data.type` + config, `position`,
 * top-level `parentId`; every `_`-prefixed key is derived state and never
 * authored here.
 */
export interface GraphNode extends NodeMeta {
  position: Point
  width?: number | null
  height?: number | null
  /** React Flow containment clamp — set alongside `parentId` (NodeFactory parity). */
  extent?: string
  selected?: boolean
}

/** A persisted graph edge — `EdgeMeta` plus the target handle and open data. */
export interface GraphEdge extends EdgeMeta {
  targetHandle?: string | null
  data?: { isLoopBackEdge?: boolean; [key: string]: unknown }
}

/** The draft `Workflow.graph` document. */
export interface DraftGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  viewport?: { x: number; y: number; zoom: number }
}

/**
 * One node, rendered for a caller: friendly `ref` (unique title, else id) and
 * `config` with every variable/resource reference in `{{Title.path}}` / slug
 * form — a model reading this never sees a raw node id or per-org CUID it
 * might try to invent.
 */
export interface NodeSummary {
  /** Friendly reference (`formatNodeRef`) — echoing it back is a valid `ref`. */
  ref: string
  id: string
  type: string
  title: string
  /** Opaque token guarding deep patches against a stale `get_node` snapshot. */
  configHash: string
  /** Friendly ref of the loop container this node lives inside, if any. */
  inside?: string
  position: Point
  /** Node config, friendly-rendered, bookkeeping keys stripped. */
  config: Record<string, unknown>
}

/** One edge, rendered for a caller with friendly node refs. */
export interface EdgeSummary {
  from: string
  to: string
  /** Source branch handle when not the default `source`. */
  branch?: string
  isLoopBack?: boolean
}

/** Compact whole-graph shape returned with every operation. */
export interface GraphSummary {
  nodeCount: number
  edgeCount: number
  nodes: Array<{ ref: string; type: string; inside?: string }>
  edges: EdgeSummary[]
  /** The draft row's trigger type column (what the workflow fires on). */
  triggerType?: string | null
  /**
   * Refs of nodes this editor can read but not author — no catalog manifest
   * (app blocks, not-yet-migrated types).
   *
   * Stated ONCE here, as data, rather than as one `info` issue per node per
   * read. The agent does need to know a node is untouchable; it does not need
   * to be told twice on every single read, forever. A workflow with two app
   * blocks put two un-actionable issues on every `get_workflow`, `get_node`,
   * `validate_workflow` AND every mutation result for the whole turn.
   */
  readOnlyNodes?: string[]
}

/**
 * What every graph mutation returns. `applied: false` means blocking issues
 * (structural, or unresolvable references) prevented the write and the draft
 * is untouched — the issues say what to fix. `applied: true` may still carry
 * non-blocking config/reference issues: a half-built workflow is legitimate
 * and persists, mirroring the canvas.
 */
export interface GraphMutationResult {
  applied: boolean
  /**
   * The mutation was a NO-OP: the requested state already held, so nothing was
   * written, snapshotted, or signalled. Still `applied: true` — the caller got
   * what it asked for. Only `applied: false` means "blocked, go fix
   * something".
   */
  unchanged?: boolean
  /** The touched node, when the operation targets one. */
  node?: NodeSummary
  /** The touched node's resolved outputs, friendly-rendered — wire refs from these. */
  outputs?: unknown[]
  issues: Issue[]
  graphSummary: GraphSummary
}

/** What `readDraft` returns: the whole draft, friendly-rendered. */
export interface DraftSummary {
  workflowAppId: string
  name: string
  triggerType?: string | null
  nodes: NodeSummary[]
  edges: EdgeSummary[]
  /** Resolved outputs per node, keyed by friendly ref, friendly-rendered. */
  outputs: Record<string, unknown[]>
  issues: Issue[]
  graphSummary: GraphSummary
}
