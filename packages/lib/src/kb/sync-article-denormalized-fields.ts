// packages/lib/src/kb/sync-article-denormalized-fields.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { updateArticleSearchText } from './article-search-text'

/**
 * Sync Article.title, Article.excerpt, Article.emoji, Article.color and
 * Article.searchText from the article's published or draft revision. Picks
 * published first, falls back to draft per-field.
 *
 * Centralized so every revision-write path uses the same rule — which is also
 * why the ranked-search corpus is maintained here rather than at each of the
 * five call sites. Anyone who keeps `title` correct keeps search correct.
 *
 * `searchText` is the one field that does NOT follow the published-first rule
 * and is NOT computed in JS: see `article-search-text.ts` for why it reads the
 * draft body, and note that computing it in SQL is what keeps a 33 KB document
 * from making a round trip through the application on every save.
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

  // Second statement, not a fifth `SET` — and the ordering is load-bearing.
  // Postgres evaluates every `SET` expression against the row as it was BEFORE
  // the update, so a `searchText = <expression reading "title">` spliced into the
  // statement above would have indexed the article's *previous* title on every
  // rename. Running it after means it reads the values just committed.
  //
  // Same connection, so it inherits the caller's transaction when one is open —
  // every call site but `publishArticle`'s trailing sync passes a `tx`.
  await updateArticleSearchText(db, articleId)
}
