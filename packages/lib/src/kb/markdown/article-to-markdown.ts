// packages/lib/src/kb/markdown/article-to-markdown.ts

import { type BlocksToMdOptions, blocksToMd } from './blocks-to-md'
import type { DocJSON } from './types'

interface ArticleLike {
  title?: string | null
  contentJson?: unknown
}

/**
 * Render a KB article as markdown for AI prompts, exports, or any other
 * downstream consumer. Pulls `contentJson` off the article and runs it
 * through the standard serializer.
 *
 * Pass `placeholders: (id) => 'value'` when you have resolved values to
 * inline; otherwise placeholders render as their literal `{{id}}` syntax.
 */
export function articleToMarkdown(article: ArticleLike, opts: BlocksToMdOptions = {}): string {
  if (!article || !article.contentJson) return ''
  return blocksToMd(article.contentJson as DocJSON, opts)
}
