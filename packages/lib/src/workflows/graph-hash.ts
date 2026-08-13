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
