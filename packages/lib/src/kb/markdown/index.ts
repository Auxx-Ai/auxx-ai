// packages/lib/src/kb/markdown/index.ts

export { articleToMarkdown } from './article-to-markdown'
export {
  BLOCK_ID_PREFIX,
  blockIdNumber,
  createBlockIdAllocator,
  maxBlockNumber,
  reassignIds,
} from './block-id'
export { type BlocksToMdOptions, blocksToMd } from './blocks-to-md'
export { computeArticleJsonHash, computeContentHash } from './hash'
export { type FrontmatterFields, mdToBlocks, parseFrontmatter } from './md-to-blocks'
export { extractHeadings, extractPlainText, walkInlineToText } from './plain-text'
export { stampBlockIds } from './stamp-ids'
export type {
  ArticleNodeJSON,
  BlockAttrs,
  BlockJSON,
  BlockType,
  CalloutVariant,
  ContainerBlockJSON,
  DocJSON,
  EmbedAspect,
  EmbedProvider,
  ImageAlign,
  InlineJSON,
  InlineMarkType,
  MarkJSON,
} from './types'
