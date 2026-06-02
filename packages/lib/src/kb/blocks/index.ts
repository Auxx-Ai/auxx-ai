// packages/lib/src/kb/blocks/index.ts

export { type ApplyPatchResult, applyPatch, PatchError } from './apply-patch'
export {
  type ArticleDiff,
  type BlockDiff,
  type BlockDiffStatus,
  diffBlockList,
  diffBlocks,
} from './diff-blocks'
export { diffInline, type InlineDiffSpan, inlineToText } from './inline-diff'
export type { ArticlePatch, BlockAnchor, ContainerKind, PatchEffect } from './patch-types'
