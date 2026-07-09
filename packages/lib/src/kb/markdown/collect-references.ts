// packages/lib/src/kb/markdown/collect-references.ts

import type { ArticleNodeJSON, BlockJSON, InlineJSON } from './types'

/**
 * Record link derived from an inline `reference` node — the shape stored in
 * `DocumentSegment.metadata.links[]` and matched by `search_knowledge`'s
 * `recordIds` filter.
 */
export interface RecordLink {
  recordId: string
  recordType?: string
}

/**
 * Collect the distinct record links referenced by an article's content.
 * Walks every inline `reference` node (including those inside tabs,
 * accordions, and tables) and keeps ids in RecordId form
 * (`entityDefinitionId:entityInstanceId`).
 */
export function collectRecordLinks(nodes: ArticleNodeJSON[] | null | undefined): RecordLink[] {
  const ids = new Set<string>()
  for (const node of nodes ?? []) {
    collectFromNode(node, ids)
  }
  return [...ids]
    .filter((id) => id.includes(':'))
    .map((id) => ({ recordId: id, recordType: id.slice(0, id.indexOf(':')) }))
}

function collectFromNode(node: ArticleNodeJSON, ids: Set<string>): void {
  if (node.type === 'block') {
    collectFromInline(node.content, ids)
    return
  }
  if (node.type === 'tabs' || node.type === 'accordion') {
    for (const panel of node.content ?? []) {
      collectFromBlocks(panel.content, ids)
    }
    return
  }
  if (node.type === 'table') {
    for (const row of node.content ?? []) {
      for (const cell of row.content ?? []) {
        collectFromBlocks(cell.content, ids)
      }
    }
  }
}

function collectFromBlocks(blocks: BlockJSON[] | undefined, ids: Set<string>): void {
  for (const block of blocks ?? []) {
    collectFromInline(block.content, ids)
  }
}

function collectFromInline(content: InlineJSON[] | undefined, ids: Set<string>): void {
  for (const node of content ?? []) {
    if (node.type !== 'reference') continue
    const id = typeof node.attrs?.id === 'string' ? node.attrs.id : ''
    if (id) ids.add(id)
  }
}
