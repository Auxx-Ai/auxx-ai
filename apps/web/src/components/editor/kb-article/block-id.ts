// apps/web/src/components/editor/kb-article/block-id.ts
//
// Editor-side mirror of the lib block-id allocator. The canonical sequential
// `b<n>` scheme lives in `@auxx/lib/kb/markdown/block-id`; here we adapt it to
// a live ProseMirror doc so the editor mints the same kind of ids the server
// and markdown parser do. Seeded from the doc's current max (high-water-mark),
// so new nodes never collide with — or renumber — existing ids.

import { BLOCK_ID_PREFIX, blockIdNumber } from '@auxx/lib/kb/markdown/block-id'
import { createIdAllocator } from '@auxx/utils'
import type { Node as PMNode } from '@tiptap/pm/model'

/** Highest sequential `b<n>` id number present anywhere in the doc (0 if none). */
export function maxBlockNumberInDoc(doc: PMNode): number {
  let max = 0
  doc.descendants((node) => {
    const n = blockIdNumber(node.attrs?.id as string | null | undefined)
    if (n !== null && n > max) max = n
    return true
  })
  return max
}

/**
 * An id allocator seeded above the doc's current max — every id it hands out
 * is unique within the doc. Share ONE instance when minting several ids in a
 * single transaction (e.g. a tabs container + its panels) so they don't repeat.
 */
export function createDocBlockIdAllocator(doc: PMNode): () => string {
  return createIdAllocator(BLOCK_ID_PREFIX, maxBlockNumberInDoc(doc))
}

/** Mint a single fresh `b<n>` id for the given doc. */
export function nextBlockId(doc: PMNode): string {
  return createDocBlockIdAllocator(doc)()
}
