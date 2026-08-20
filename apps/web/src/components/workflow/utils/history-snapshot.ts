// apps/web/src/components/workflow/utils/history-snapshot.ts

import type { FlowEdge, FlowNode } from '../types'

/**
 * The one shape a history entry stores a graph in.
 *
 * Three producers write history snapshots — canvas edits
 * (`use-save-to-history`), the Kopilot/server rehydrate
 * (`use-workflow-draft-realtime`) and version restore
 * (`workflow-versions-popover`) — and before this module they each cloned the
 * graph their own way. An undo could therefore restore a differently-shaped
 * node depending on which entry it landed on.
 *
 * ## Why a whitelist rather than a spread
 *
 * A snapshot must not carry React Flow's internals (`internals`, `handles`,
 * measured boxes) back onto the canvas on restore: those describe the *current*
 * canvas, not the authored graph, and replaying a stale copy is how a restore
 * ends up with dead handles. The whitelist is the filter.
 *
 * ## Why interaction state is NOT in it
 *
 * `selected` / `dragging` / `measured` are interaction state, not authored
 * content (`utils/interaction-state.ts`). A snapshot that stores them claims an
 * authored selection it has no business having — restoring one used to move the
 * user's selection and, via `selection:changed` → `panel-store`, open a panel
 * for a node they were not looking at. The restore seam in
 * `workflow-history-provider` runs `mergeInteractionState` instead, which takes
 * those keys from the live canvas. So they are deliberately absent here.
 */

/**
 * `FlowNode` / `FlowEdge` are hand-rolled aliases that declare a subset of what
 * React Flow actually puts on a node at runtime (`style`, `className`,
 * `hidden`, `focusable`, `expandParent`, `connectable` are all real and all
 * undeclared). The whitelist preserves them, so it reads through a widened
 * view rather than pretending the alias is complete.
 */
type RawNode = FlowNode & Record<string, unknown>

/** Clone one node into the canonical history shape. */
export function cloneNodeForHistory(node: FlowNode): FlowNode {
  const n = node as RawNode
  return {
    id: n.id,
    type: n.type,
    position: { ...n.position },
    data: { ...n.data },
    width: n.width,
    height: n.height,
    sourcePosition: n.sourcePosition,
    targetPosition: n.targetPosition,
    style: n.style,
    className: n.className,
    parentId: n.parentId,
    zIndex: n.zIndex,
    extent: n.extent,
    expandParent: n.expandParent,
    draggable: n.draggable,
    selectable: n.selectable,
    connectable: n.connectable,
    deletable: n.deletable,
    focusable: n.focusable,
    hidden: n.hidden,
  } as FlowNode
}

/** Clone one edge into the canonical history shape. */
export function cloneEdgeForHistory(edge: FlowEdge): FlowEdge {
  return {
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
    type: edge.type,
    data: edge.data ? { ...edge.data } : undefined,
    animated: edge.animated,
    hidden: edge.hidden,
    deletable: edge.deletable,
    focusable: edge.focusable,
    selectable: edge.selectable,
    markerStart: edge.markerStart,
    markerEnd: edge.markerEnd,
    zIndex: edge.zIndex,
    ariaLabel: edge.ariaLabel,
    interactionWidth: edge.interactionWidth,
    className: edge.className,
    style: edge.style,
  } as FlowEdge
}

/** The `data` payload of a `workflow_event` history entry. */
export interface GraphSnapshot {
  event: string
  nodes: FlowNode[]
  edges: FlowEdge[]
}

/** Snapshot a whole graph for one history entry. */
export function snapshotGraph(
  event: string,
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[]
): GraphSnapshot {
  return {
    event,
    nodes: nodes.map(cloneNodeForHistory),
    edges: edges.map(cloneEdgeForHistory),
  }
}
