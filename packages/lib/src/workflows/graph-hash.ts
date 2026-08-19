// packages/lib/src/workflows/graph-hash.ts

import { createHash } from 'node:crypto'
import { stableStringify } from '@auxx/utils/json'

/**
 * SHA-256 content hash of a workflow draft graph — the token for the draft
 * save path's compare-and-swap (mirrors `hashDoc` in
 * `agents/procedures/authoring/queries.ts`).
 *
 * Serializes with {@link stableStringify} (sorted keys) so the hash is stable
 * across the Postgres `jsonb` round-trip: `jsonb` does NOT preserve object key
 * order, so a plain `JSON.stringify` of the in-memory graph would not match
 * the same graph read back from the column — every save would look stale.
 */
export function hashWorkflowGraph(graph: unknown): string {
  return createHash('sha256').update(stableStringify(graph), 'utf8').digest('hex')
}

/**
 * React Flow interaction state that lives in the graph document but carries no
 * authored meaning. Panning, clicking a node, or letting the canvas re-measure
 * a node rewrites these — and the editor autosaves the result, so a graph that
 * nobody edited still hashes differently on every visit.
 *
 * `position` is deliberately NOT here: dragging a node is a real edit the user
 * made. `width`/`height` are, because React Flow writes its own measurements
 * into them; if a node type ever becomes user-resizable, move them out.
 */
const EPHEMERAL_NODE_KEYS = new Set([
  'selected',
  'dragging',
  'resizing',
  'selectable',
  'focusable',
  'deletable',
  'draggable',
  'zIndex',
  'width',
  'height',
  'measured',
  'positionAbsolute',
])

/** Ephemeral state on an edge — same argument as {@link EPHEMERAL_NODE_KEYS}. */
const EPHEMERAL_EDGE_KEYS = new Set(['selected', 'animated', 'zIndex'])

function stripEphemeral(item: Record<string, unknown>, drop: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(item)) {
    if (!drop.has(k)) out[k] = v
  }
  return out
}

/**
 * SHA-256 hash of a graph's AUTHORED content — nodes and edges with React Flow's
 * interaction state removed, and the viewport dropped entirely.
 *
 * Answers "did anyone actually change this workflow?", which
 * {@link hashWorkflowGraph} cannot: that one hashes the whole document, so a
 * pan or a node click changes it. Two things depend on the distinction:
 *
 *  - `WorkflowService.update` clears the Kopilot turn snapshot on a manual save.
 *    Keyed off the full hash, merely OPENING the builder fires an autosave that
 *    destroys the pending Undo offer seconds after it appears.
 *  - `revertWorkflowTurn` refuses when the live draft no longer matches what the
 *    turn left behind. Keyed off the full hash, the same autosave turns every
 *    Undo into a "the canvas moved on" conflict.
 *
 * Both must ask the semantic question, or the Undo offer is unusable in practice
 * (plans/kopilot/workflow/20-partial-turn-survival.md F5).
 *
 * Never use this as the save-path CAS token — that one MUST stay full-document,
 * because two tabs disagreeing about the viewport is still a real write conflict.
 */
export function hashGraphSemantics(graph: unknown): string {
  const g = (graph ?? {}) as { nodes?: unknown[]; edges?: unknown[] }
  const projection = {
    nodes: (g.nodes ?? []).map((n) =>
      stripEphemeral((n ?? {}) as Record<string, unknown>, EPHEMERAL_NODE_KEYS)
    ),
    edges: (g.edges ?? []).map((e) =>
      stripEphemeral((e ?? {}) as Record<string, unknown>, EPHEMERAL_EDGE_KEYS)
    ),
  }
  return createHash('sha256').update(stableStringify(projection), 'utf8').digest('hex')
}
