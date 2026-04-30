// packages/lib/src/kb/markdown/hash.ts

import { createHash } from 'node:crypto'

/** sha256 hex of the markdown content. Used to skip re-embedding when an article hasn't changed. */
export function computeContentHash(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex')
}
