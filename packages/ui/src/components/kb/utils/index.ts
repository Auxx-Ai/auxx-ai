// packages/ui/src/components/kb/utils/index.ts

export { getArticleNeighbours } from './article-neighbours'
export {
  type ArticleSlugFields,
  findArticleBySlugPath,
  getArticleParentLink,
  getArticleSlugPaths,
  getFullSlugPath,
  getKbPreviewHref,
  isArticleActive,
} from './article-paths'
export {
  type ArticleTreeFields,
  type ArticleTreeNode,
  buildArticleTree,
  findAncestorIds,
  findArticleAndParent,
  findArticleById,
  flattenArticleTreePreservingChildren,
} from './article-tree'
export { type EmbedProvider, type ParsedEmbed, parseEmbedUrl } from './embed'
export { extractHeadings, extractPlainText, walkInlineToText } from './inline-text'
