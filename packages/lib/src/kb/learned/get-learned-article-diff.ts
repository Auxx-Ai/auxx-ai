// packages/lib/src/kb/learned/get-learned-article-diff.ts

import { type Database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { articleToMarkdown } from '../markdown/article-to-markdown'
import type { ArticleNodeJSON } from '../markdown/types'
import { diffMarkdownLines, type MarkdownDiff } from './diff-markdown'

export interface LearnedArticleDiff extends MarkdownDiff {
  /** False when the article no longer exists — the caller falls back to a flat preview. */
  found: boolean
  /** Current article title, so the reviewer sees a rename as a rename. */
  currentTitle: string | null
}

/**
 * Diff a proposed memory rewrite against the article as it stands today.
 *
 * Reads the PUBLISHED revision, because published is what AI Memory recalls
 * and what a human would have been reading when they corrected it — an
 * unpublished draft is not the thing the proposal is about to overwrite.
 */
export async function getLearnedArticleDiff(
  db: Database,
  params: { organizationId: string; articleId: string; markdown: string }
): Promise<LearnedArticleDiff> {
  const { organizationId, articleId, markdown } = params

  const article = await db.query.Article.findFirst({
    where: and(eq(schema.Article.id, articleId), eq(schema.Article.organizationId, organizationId)),
    columns: { id: true, title: true, homeKnowledgeBaseId: true },
  })
  if (!article) {
    return { found: false, currentTitle: null, lines: [], addedCount: 0, removedCount: 0 }
  }

  const placement = await db.query.ArticlePlacement.findFirst({
    where: and(
      eq(schema.ArticlePlacement.articleId, articleId),
      eq(schema.ArticlePlacement.knowledgeBaseId, article.homeKnowledgeBaseId)
    ),
    columns: { publishedRevisionId: true },
  })
  const revision = placement?.publishedRevisionId
    ? await db.query.ArticleRevision.findFirst({
        where: eq(schema.ArticleRevision.id, placement.publishedRevisionId),
        columns: { title: true, contentJson: true },
      })
    : undefined

  const current = articleToMarkdown({
    title: revision?.title ?? article.title,
    contentJson: (revision?.contentJson as ArticleNodeJSON[] | null) ?? null,
  })

  return {
    found: true,
    currentTitle: revision?.title ?? article.title,
    ...diffMarkdownLines(current, markdown),
  }
}
