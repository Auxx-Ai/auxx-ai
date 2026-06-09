// packages/lib/src/kb/markdown/hash.ts

import { createHash } from 'node:crypto'
import { stableHash } from '@auxx/utils/hash'
import type { ArticleNodeJSON } from './types'

/** sha256 hex of the markdown content. Used to skip re-embedding when an article hasn't changed. */
export function computeContentHash(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex')
}

/**
 * Stable sha256 hex of an article body's canonical JSON. Key-order-independent,
 * so an in-memory doc and the same doc read back from the `contentJson` jsonb
 * column hash identically (a plain `JSON.stringify` hash would diverge across
 * the round-trip). Used by the realtime sync protocol and draft/published
 * divergence checks to detect when content actually changed.
 */
export function computeArticleJsonHash(content: ArticleNodeJSON[] | null | undefined): string {
  return stableHash(content ?? [])
}
