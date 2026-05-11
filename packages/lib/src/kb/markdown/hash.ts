// packages/lib/src/kb/markdown/hash.ts

import { createHash } from 'node:crypto'
import type { ArticleNodeJSON } from './types'

/** sha256 hex of the markdown content. Used to skip re-embedding when an article hasn't changed. */
export function computeContentHash(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex')
}

/**
 * sha256 hex of the canonical JSON representation of an article body.
 * Used by the realtime sync protocol so server and client can detect
 * doc divergence (e.g. agent and manual edits crossing) without
 * re-marshalling through markdown.
 */
export function computeArticleJsonHash(content: ArticleNodeJSON[] | null | undefined): string {
  return createHash('sha256')
    .update(JSON.stringify(content ?? []), 'utf8')
    .digest('hex')
}
