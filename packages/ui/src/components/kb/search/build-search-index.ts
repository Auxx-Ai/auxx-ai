// packages/ui/src/components/kb/search/build-search-index.ts

import type { DocJSON } from '../article/types'
import { extractHeadings, extractPlainText } from '../utils/inline-text'

export interface KBSearchDoc {
  id: string
  slug: string
  /** Full slug path (e.g. `getting-started/install`). Used to build the link. */
  path: string
  title: string
  description?: string
  headings: string[]
  body: string
}

export interface KBSearchInputArticle {
  id: string
  slug: string
  title: string
  description?: string | null
  contentJson: DocJSON | null | undefined
  isPublished: boolean
  articleKind?: 'page' | 'category' | 'header' | 'tab' | 'link'
  parentId: string | null
}

const MAX_BODY = 4000

export function buildKBSearchIndex(
  articles: KBSearchInputArticle[],
  fullPathById: Record<string, string>
): KBSearchDoc[] {
  const out: KBSearchDoc[] = []
  for (const article of articles) {
    if (!article.isPublished) continue
    if (article.articleKind === 'tab' || article.articleKind === 'header') continue
    // Links are external pointers, not internal articles — skip them. The
    // current search UI dispatches results via internal path navigation,
    // which doesn't fit a "go open this URL in a new tab" result.
    if (article.articleKind === 'link') continue
    out.push({
      id: article.id,
      slug: article.slug,
      path: fullPathById[article.id] ?? article.slug,
      title: article.title,
      description: article.description ?? undefined,
      headings: extractHeadings(article.contentJson ?? undefined),
      body: extractPlainText(article.contentJson ?? undefined).slice(0, MAX_BODY),
    })
  }
  return out
}
