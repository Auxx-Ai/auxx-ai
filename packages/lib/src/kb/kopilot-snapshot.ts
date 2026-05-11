// packages/lib/src/kb/kopilot-snapshot.ts

import { createScopedLogger } from '@auxx/logger'
import { deleteRedisData, getRedisData, setRedisData } from '@auxx/redis'
import type { ArticleNodeJSON } from './markdown/types'

const logger = createScopedLogger('kopilot-snapshot')

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

const snapshotKey = (articleId: string): string => `kb:article:${articleId}:preturn`

/**
 * Write the snapshot, overwriting any prior one. Caller is responsible
 * for only invoking this on the FIRST write of a turn (subsequent writes
 * in the same turn must not bump the snapshot — that would defeat
 * per-turn Undo).
 */
export async function captureKopilotSnapshot(
  articleId: string,
  snapshot: KopilotPreTurnSnapshot
): Promise<void> {
  await setRedisData(snapshotKey(articleId), snapshot, TTL_SECONDS)
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
  const raw = (await getRedisData(snapshotKey(articleId))) as KopilotPreTurnSnapshot | null
  if (!raw) return null
  if (expectedTurnId && raw.turnId !== expectedTurnId) return null
  return raw
}

/**
 * Delete the snapshot. Called from any non-Kopilot write path
 * (manual edit, publish, version restore) so the Undo button on
 * the most recent agent message disables itself.
 */
export async function clearKopilotSnapshot(articleId: string): Promise<void> {
  try {
    await deleteRedisData(snapshotKey(articleId))
  } catch (error) {
    // Best-effort: a stale snapshot in Redis isn't catastrophic — at
    // worst, the Undo button reverts to a stale state. The hash check
    // in the revert path will refuse if the snapshot doesn't match.
    logger.warn('Failed to clear Kopilot snapshot', {
      articleId,
      error: (error as Error).message,
    })
  }
}
