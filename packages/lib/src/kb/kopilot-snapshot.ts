// packages/lib/src/kb/kopilot-snapshot.ts

/**
 * Per-turn pre-edit snapshot of a KB article - SERVER-ONLY (Redis).
 *
 * The Redis mechanics live in `turn-scoped/turn-slot.ts`, which states the four
 * invariants and why each is load-bearing. THIS module names the article's key,
 * TTL and payload.
 */

import { createTurnSlot } from '../turn-scoped/turn-slot'
import type { ArticleNodeJSON } from './markdown/types'

const TTL_SECONDS = 24 * 60 * 60

/**
 * Per-turn snapshot captured before Kopilot's first write to an article.
 * Backs the per-turn Undo affordance (`article-block-crud.md` §3) and the
 * auto-rollback path on agent failure.
 *
 * One slot per article — each new turn overwrites the prior snapshot.
 * Naturally expires after 24h via Redis TTL.
 */
export interface KopilotPreTurnSnapshot {
  turnId: string
  sessionId: string
  contentJson: ArticleNodeJSON[]
  contentHash: string
  capturedAt: number
}

const slot = createTurnSlot<KopilotPreTurnSnapshot>({
  key: (articleId: string) => `kb:article:${articleId}:preturn`,
  ttlSeconds: TTL_SECONDS,
  logScope: 'kopilot-snapshot',
})

/**
 * Write the snapshot for its turn. Callers still only invoke this on the FIRST
 * write of a turn (subsequent writes in the same turn must not bump the
 * snapshot, that would defeat per-turn Undo).
 *
 * This used to overwrite unconditionally and leave that rule entirely to the
 * caller. `slot.capture` is idempotent per turn (invariant 1 of
 * `turn-scoped/turn-slot.ts`), so the rule is now enforced here too. That is a
 * no-op against the only caller, `runBlockCrudOp` in
 * `ai/kopilot/capabilities/kb/tools/write-helpers.ts`, which does its own
 * once-per-turn read-check first; it just means the contract no longer depends
 * on that check being there.
 */
export async function captureKopilotSnapshot(
  articleId: string,
  snapshot: KopilotPreTurnSnapshot
): Promise<void> {
  await slot.capture(articleId, snapshot)
}

/**
 * Read the current snapshot for an article. Optionally verify it
 * belongs to a specific turn — pass `expectedTurnId` and the call
 * returns null if the stored snapshot is from a different (newer)
 * turn. This is how the Undo button on an old assistant message
 * detects that a fresher turn has superseded its snapshot.
 */
export async function readKopilotSnapshot(
  articleId: string,
  expectedTurnId?: string
): Promise<KopilotPreTurnSnapshot | null> {
  return slot.read(articleId, expectedTurnId)
}

/**
 * Delete the snapshot. Called from any non-Kopilot write path
 * (manual edit, publish, version restore) so the Undo button on
 * the most recent agent message disables itself.
 *
 * Best-effort (`slot.clear` swallows and logs): a stale snapshot in Redis isn't
 * catastrophic, at worst the Undo button reverts to a stale state, and the hash
 * check in the revert path will refuse if the snapshot doesn't match.
 */
export async function clearKopilotSnapshot(articleId: string): Promise<void> {
  await slot.clear(articleId)
}
