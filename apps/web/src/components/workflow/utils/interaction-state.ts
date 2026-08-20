// apps/web/src/components/workflow/utils/interaction-state.ts

import type { FlowEdge, FlowNode } from '../types'
import { initializeWorkflow } from './workflow-initializer'

/**
 * The hydrator's sibling at the REHYDRATE seams
 * (`plans/kopilot/workflow/23-graph-document-canonicalization.md` §5, last
 * trap).
 *
 * Hydration answers "what does the server's document mean?". This answers the
 * other half of the same question at the two seams where a fetched document
 * replaces a canvas the user is *currently looking at*: **authored content
 * comes from the server, interaction state stays local.**
 *
 * ## Why it has to exist
 *
 * `workflow-canvas.tsx`'s `workflow:externalUpdate` handler calls
 * `setNodes(payload.nodes)` wholesale, with no merge. That already misbehaves
 * today, in the *other* direction: the fetched document carries whatever
 * `selected` happened to be persisted, so a Kopilot edit can jump the selection
 * to a node the user is not looking at and — via `selection:changed` →
 * `panel-store` — open its panel.
 *
 * Once the write seam strips selection (23 §1.2), the incoming nodes carry
 * none at all, and the failure flips: **every agent edit would silently
 * deselect whatever the user had selected**, closing their panel mid-edit.
 * Neither shape is acceptable, and one merge fixes both.
 *
 * ## What INITIAL LOAD must NOT do
 *
 * Nothing here belongs on the initial load path. There is no prior selection to
 * carry, and opening with nothing selected is precisely the fix: it is what
 * stops React Flow's `SelectionListener` replaying a persisted `selected` on
 * mount → `selection:changed` → panel open → `centerOnNode` → viewport change →
 * save (`22` §1.2).
 */

/** React Flow interaction state for one node — never authored, never persisted. */
export interface NodeInteractionState {
  selected?: boolean
  dragging?: boolean
  /**
   * React Flow's measured box. Re-measuring is cheap but not free, and a node
   * that loses it renders at zero size for a frame — a visible flicker on every
   * agent edit.
   */
  measured?: { width?: number; height?: number }
}

/**
 * The keys carried forward. Deliberately short: `width`/`height` are NOT here,
 * because `handleNodeResize` writes an authored container size and the server's
 * value must win.
 */
const INTERACTION_KEYS = ['selected', 'dragging', 'measured'] as const

/** Snapshot the live canvas's interaction state, keyed by node id. */
export function captureInteractionState(
  liveNodes: readonly FlowNode[]
): Map<string, NodeInteractionState> {
  const byId = new Map<string, NodeInteractionState>()
  for (const node of liveNodes) {
    const state: NodeInteractionState = {}
    for (const key of INTERACTION_KEYS) {
      const value = (node as Record<string, unknown>)[key]
      if (value !== undefined) (state as Record<string, unknown>)[key] = value
    }
    if (Object.keys(state).length > 0) byId.set(node.id, state)
  }
  return byId
}

/**
 * Authored content from `incomingNodes`, interaction state from `liveNodes`,
 * matched by node id.
 *
 * A node the incoming document does not contain is simply gone — its state is
 * dropped with it. A node the incoming document ADDS starts with no
 * interaction state, which is what makes an agent-added node render unselected
 * rather than inheriting a stale flag.
 *
 * @returns a new array; neither input is mutated
 */
export function mergeInteractionState(
  incomingNodes: readonly FlowNode[],
  liveNodes: readonly FlowNode[]
): FlowNode[] {
  const live = captureInteractionState(liveNodes)
  if (live.size === 0) return [...incomingNodes]

  return incomingNodes.map((node) => {
    const state = live.get(node.id)
    if (!state) return node
    return { ...node, ...state }
  })
}

/**
 * A stored graph document → a canvas that replaces one the user is looking at.
 * Hydration and {@link mergeInteractionState} in one call, for the version
 * popover's preview and restore paths.
 *
 * A stored `WorkflowVersion.graph` is a DOCUMENT, not a canvas: it carries no
 * `node.type`, so pushing it into React Flow raw falls back to the built-in
 * default node (`FLOW_NODE_TYPES` is `{standard, note}`) — grey boxes, no
 * handles, no panels. Silent, not a crash (plan 23 §5). The RESTORE path is the
 * dangerous one, because the un-hydrated graph becomes the live EDITABLE canvas
 * and autosave writes it straight back to the draft.
 *
 * @param graph a raw stored graph — `nodes` / `edges` are validated, not trusted
 * @param liveNodes the canvas being replaced, for the interaction-state carry
 */
export function storedGraphToCanvas(
  graph: { nodes?: unknown; edges?: unknown } | null | undefined,
  liveNodes: readonly FlowNode[]
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const storedNodes = Array.isArray(graph?.nodes) ? (graph.nodes as FlowNode[]) : []
  const storedEdges = Array.isArray(graph?.edges) ? (graph.edges as FlowEdge[]) : []
  const { nodes, edges } = initializeWorkflow(storedNodes, storedEdges)
  return { nodes: mergeInteractionState(nodes, liveNodes), edges }
}
