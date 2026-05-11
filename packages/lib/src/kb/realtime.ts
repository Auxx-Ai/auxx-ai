// packages/lib/src/kb/realtime.ts

import { createScopedLogger } from '@auxx/logger'
import { getPublishingClient } from '@auxx/redis'
import type { ArticlePatch } from './blocks/patch-types'
import type { ArticleNodeJSON } from './markdown/types'

const logger = createScopedLogger('kb-realtime')

export const kbArticleChannel = (articleId: string): string => `kb:article:${articleId}`

/**
 * Realtime events for the per-article SSE channel. The editor (and any
 * other subscribed client) reacts to these:
 *
 * - `patch`: Kopilot applied a single block-CRUD op. Carries the
 *   minimal patch + pre/post hashes so the client can verify it's in
 *   sync. Manual user edits do NOT use patch — they emit `resync`.
 * - `resync`: full doc replacement. Sent after manual saves, on
 *   demand when a hash mismatch is detected, and after Kopilot
 *   auto-rollback.
 * - `lock`: the article is being edited by Kopilot. Editors switch
 *   read-only while locked.
 */
export type KbArticleEvent =
  | {
      type: 'kb-article-patch'
      articleId: string
      patch: ArticlePatch
      preHash: string
      postHash: string
      cause: { kind: 'kopilot'; turnId: string; opIndex: number }
    }
  | {
      type: 'kb-article-resync'
      articleId: string
      contentJson: ArticleNodeJSON[]
      contentHash: string
      cause: { kind: 'kopilot' | 'manual' | 'revert'; turnId?: string }
    }
  | {
      type: 'kb-article-lock'
      articleId: string
      locked: boolean
      by: 'kopilot'
      turnId: string
      expiresAt?: number
    }

/**
 * Publish an event to the per-article Redis channel. Best-effort: a
 * publish failure logs but does not throw — the article-level write
 * itself has already succeeded, the event is just realtime push.
 */
export async function publishKbArticleEvent(
  articleId: string,
  event: KbArticleEvent
): Promise<void> {
  try {
    const redis = await getPublishingClient()
    if (!redis) {
      logger.warn('No Redis publishing client available', { articleId })
      return
    }
    await redis.publish(kbArticleChannel(articleId), JSON.stringify(event))
  } catch (error) {
    logger.error('Failed to publish KB article event', {
      articleId,
      type: event.type,
      error: (error as Error).message,
    })
  }
}
