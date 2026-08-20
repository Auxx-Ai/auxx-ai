// packages/lib/src/workflows/graph-hash.ts

import { createHash } from 'node:crypto'
import { stableStringify } from '@auxx/utils/json'
import { projectGraphSemantics } from './graph-projection'

export {
  EPHEMERAL_EDGE_DATA_KEYS,
  EPHEMERAL_EDGE_KEYS,
  EPHEMERAL_NODE_DATA_KEYS,
  EPHEMERAL_NODE_KEYS,
  projectGraphSemantics,
} from './graph-projection'

/**
 * SHA-256 content hash of a workflow draft graph — the token for the draft
 * save path's compare-and-swap (mirrors `hashDoc` in
 * `agents/procedures/authoring/queries.ts`).
 *
 * Serializes with {@link stableStringify} (sorted keys) so the hash is stable
 * across the Postgres `jsonb` round-trip: `jsonb` does NOT preserve object key
 * order, so a plain `JSON.stringify` of the in-memory graph would not match
 * the same graph read back from the column — every save would look stale.
 *
 * FULL-DOCUMENT, over the RAW STORED graph, and it must stay that way: it is
 * minted from the row and re-checked against the row inside the CAS
 * transaction, so anything that projects, cleans or hydrates between the read
 * and the mint makes the token stop describing the column — and every save
 * 409s, forever (plans/kopilot/workflow/23 §3.2).
 */
export function hashWorkflowGraph(graph: unknown): string {
  return createHash('sha256').update(stableStringify(graph), 'utf8').digest('hex')
}

/**
 * SHA-256 hash of a graph's AUTHORED content — see {@link projectGraphSemantics}
 * for exactly what that means.
 *
 * Answers "did anyone actually change this workflow?", which
 * {@link hashWorkflowGraph} cannot: that one hashes the whole document, so a
 * pan, a node click, a re-measure or merely OPENING the builder (the load path
 * re-derives a dozen fields back into the document) changes it. Two things
 * depend on the distinction:
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
  return createHash('sha256')
    .update(stableStringify(projectGraphSemantics(graph)), 'utf8')
    .digest('hex')
}
