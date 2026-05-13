// packages/lib/src/kb/sync-article-denormalized-fields.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { eq } from 'drizzle-orm'

/**
 * Sync Article.title, Article.excerpt, Article.emoji, and Article.color
 * from the article's published or draft revision. Picks published first,
 * falls back to draft per-field.
 *
 * Centralized so every revision-write path uses the same rule.
 */
export async function syncArticleDenormalizedFields(
  articleId: string,
  db: Database | Transaction
): Promise<void> {
  const article = await db.query.Article.findFirst({
    where: eq(schema.Article.id, articleId),
    columns: { publishedRevisionId: true, draftRevisionId: true },
  })
  if (!article) return

  let title: string | null = null
  let excerpt: string | null = null
  let emoji: string | null = null
  let color: string | null = null

  if (article.publishedRevisionId) {
    const pub = await db.query.ArticleRevision.findFirst({
      where: eq(schema.ArticleRevision.id, article.publishedRevisionId),
      columns: { title: true, excerpt: true, emoji: true, color: true },
    })
    if (pub) {
      title = pub.title ?? null
      excerpt = pub.excerpt ?? null
      emoji = pub.emoji ?? null
      color = pub.color ?? null
    }
  }
  if (
    (title === null || excerpt === null || emoji === null || color === null) &&
    article.draftRevisionId
  ) {
    const draft = await db.query.ArticleRevision.findFirst({
      where: eq(schema.ArticleRevision.id, article.draftRevisionId),
      columns: { title: true, excerpt: true, emoji: true, color: true },
    })
    if (draft) {
      if (title === null) title = draft.title ?? null
      if (excerpt === null) excerpt = draft.excerpt ?? null
      if (emoji === null) emoji = draft.emoji ?? null
      if (color === null) color = draft.color ?? null
    }
  }

  await db
    .update(schema.Article)
    .set({ title, excerpt, emoji, color })
    .where(eq(schema.Article.id, articleId))
}
