// packages/lib/src/ai/kopilot/capabilities/kb/tools/replace-plan.ts
//
// Pure planning logic for a markdown `replace_block`. Kept free of any
// server-only imports (db, KBService, realtime) so it can be unit-tested
// in isolation — `write-helpers.ts` wires it to the I/O.

import type { ArticlePatch } from '../../../../../kb/blocks/patch-types'
import type { ArticleNodeJSON } from '../../../../../kb/markdown/types'

/**
 * Plan the patch sequence for a markdown `replace_block`. Markdown carries
 * no block id, so the first parsed node inherits the target id and any
 * extras are spliced in right after with fresh ids:
 *
 *  - empty markdown (zero blocks) → `delete(blockId)`. "Replace with nothing"
 *    is a remove — there's no first block to carry the id, so it can't be a
 *    1:1 replace.
 *  - first node is a leaf → `replace(blockId, first)` (id preserved) then,
 *    if there are extras, `insert(after blockId, rest)`. The turn-review
 *    diff stays a clean "modified" + N "added", realtime patches keep
 *    targeting, and per-block Undo survives.
 *  - first node is a container (e.g. rewriting a paragraph into a table) →
 *    a 1:1 leaf replace can't carry the id, so splice the whole rewrite in
 *    `before` the target and `delete` it. This is a type change; id churn
 *    on that one block is accepted.
 */
export function planMarkdownReplace(blockId: string, nodes: ArticleNodeJSON[]): ArticlePatch[] {
  const first = nodes[0]
  if (!first) {
    return [{ op: 'delete', blockIds: [blockId] }]
  }
  const rest = nodes.slice(1)
  if (first.type === 'block') {
    const patches: ArticlePatch[] = [
      { op: 'replace', blockId, block: { ...first, attrs: { ...first.attrs, id: blockId } } },
    ]
    if (rest.length > 0) {
      patches.push({ op: 'insert', anchor: { at: 'after', blockId }, blocks: rest })
    }
    return patches
  }
  return [
    { op: 'insert', anchor: { at: 'before', blockId }, blocks: nodes },
    { op: 'delete', blockIds: [blockId] },
  ]
}
