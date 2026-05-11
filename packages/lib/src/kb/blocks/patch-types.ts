// packages/lib/src/kb/blocks/patch-types.ts

import type {
  ArticleNodeJSON,
  BlockAttrs,
  BlockJSON,
  ContainerBlockJSON,
  InlineJSON,
} from '../markdown/types'

/**
 * Anchor describing where a block-mutation op lands. Either positional
 * (start/end of the document) or relative to an existing block id.
 *
 * `startOf` / `endOf` are for moving / inserting INTO a container by its
 * id — e.g. an empty panel where there's no existing child to anchor on.
 */
export type BlockAnchor =
  | { at: 'start' }
  | { at: 'end' }
  | { at: 'before'; blockId: string }
  | { at: 'after'; blockId: string }
  | { at: 'startOf'; containerId: string }
  | { at: 'endOf'; containerId: string }

export type ArticlePatch =
  | { op: 'insert'; anchor: BlockAnchor; blocks: ArticleNodeJSON[] }
  | { op: 'replace'; blockId: string; block: BlockJSON }
  | { op: 'updateText'; blockId: string; content: InlineJSON[] }
  | { op: 'updateAttrs'; blockId: string; attrs: Partial<BlockAttrs> }
  | { op: 'delete'; blockIds: string[] }
  | { op: 'move'; blockIds: string[]; anchor: BlockAnchor }

/**
 * Result of applying a patch to a doc. `kind` mirrors the input op so
 * downstream consumers (snapshot mining, scroll-to-block, etc.) can
 * reference the affected ids without re-deriving them.
 */
export interface PatchEffect {
  op: ArticlePatch['op']
  blockIds: string[]
}

export type ContainerKind = ContainerBlockJSON['type']
