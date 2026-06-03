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
  // Single round-trip: the article with its draft revision and every placement's
  // published revision. Published metadata is per-placement now; we denormalize
  // from the home placement's published revision (the canonical published
  // baseline), falling back to the draft per-field.
  const revisionCols = { title: true, excerpt: true, emoji: true, color: true } as const
  const article = await db.query.Article.findFirst({
    where: eq(schema.Article.id, articleId),
    columns: { homeKnowledgeBaseId: true },
    with: {
      draftRevision: { columns: revisionCols },
      placements: {
        columns: { knowledgeBaseId: true },
        with: { publishedRevision: { columns: revisionCols } },
      },
    },
  })
  if (!article) return

  const pub = article.placements.find(
    (p) => p.knowledgeBaseId === article.homeKnowledgeBaseId
  )?.publishedRevision
  const draft = article.draftRevision

  // Prefer the published value per-field, fall back to the draft.
  const title = pub?.title ?? draft?.title ?? null
  const excerpt = pub?.excerpt ?? draft?.excerpt ?? null
  const emoji = pub?.emoji ?? draft?.emoji ?? null
  const color = pub?.color ?? draft?.color ?? null

  await db
    .update(schema.Article)
    .set({ title, excerpt, emoji, color })
    .where(eq(schema.Article.id, articleId))
}
