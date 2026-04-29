// packages/ui/src/components/kb/utils/index.ts

export { getArticleNeighbours } from './article-neighbours'
export {
  type ArticleSlugFields,
  findArticleBySlugPath,
  getArticleSlugPaths,
  getFullSlugPath,
  isArticleActive,
} from './article-paths'
export {
  type ArticleTreeFields,
  type ArticleTreeNode,
  buildArticleTree,
  findAncestorIds,
  findArticleAndParent,
  findArticleById,
  flattenArticleTree,
  flattenArticleTreePreservingChildren,
} from './article-tree'
export { extractHeadings, extractPlainText, walkInlineToText } from './inline-text'
