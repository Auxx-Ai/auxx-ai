// @auxx/lib/kb/articles/add-placement.ts
// Place an *existing* Article into an additional KnowledgeBase (multi-home). Unlike
// createArticle (which mints content + its home placement), this only adds a tree
// position + publish state for content that already exists — the basis for linking a
// source's articles into user-facing KBs. Idempotent per (articleId, knowledgeBaseId).

import { schema } from '@auxx/database'
import { generateId } from '@auxx/utils'
import { and, eq } from 'drizzle-orm'
import { resolveDb } from '../internal/context'
import { getNextPlacementSortOrder } from '../internal/placement'
import type { KBContext } from '../types'

type PlacementRow = typeof schema.ArticlePlacement.$inferSelect

export interface AddPlacementInput {
  articleId: string
  knowledgeBaseId: string
  /** Parent *placement* id in the target KB (not article-id space). Null = root. */
  parentPlacementId?: string | null
  sortOrder?: string
  /** Marks the position as a live link to a source (set by the link helpers). */
  linkedFromSourceId?: string | null
  isPublished?: boolean
}

/**
 * Ensure a slug that's unique within the target KB. Prefers the article's existing
 * slug (so a linked article keeps a stable URL); on collision, suffixes a short id.
 */
async function uniqueSlugInKb(
  db: ReturnType<typeof resolveDb>,
  knowledgeBaseId: string,
  baseSlug: string
): Promise<string> {
  const taken = await db.query.ArticlePlacement.findFirst({
    where: and(
      eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId),
      eq(schema.ArticlePlacement.slug, baseSlug)
    ),
    columns: { id: true },
  })
  return taken ? `${baseSlug}-${generateId().slice(0, 6)}` : baseSlug
}

/**
 * Add (idempotently) a placement of an existing article into `knowledgeBaseId`. Returns
 * the existing placement unchanged when one already exists for (article, KB).
 */
export async function addPlacement(
  ctx: KBContext,
  input: AddPlacementInput
): Promise<PlacementRow> {
  const db = resolveDb(ctx)

  const existing = await db.query.ArticlePlacement.findFirst({
    where: and(
      eq(schema.ArticlePlacement.articleId, input.articleId),
      eq(schema.ArticlePlacement.knowledgeBaseId, input.knowledgeBaseId),
      eq(schema.ArticlePlacement.organizationId, ctx.organizationId)
    ),
  })
  if (existing) return existing

  // Base the slug on the article's home placement so links keep a stable URL.
  const home = await db.query.ArticlePlacement.findFirst({
    where: and(
      eq(schema.ArticlePlacement.articleId, input.articleId),
      eq(schema.ArticlePlacement.organizationId, ctx.organizationId)
    ),
    columns: { slug: true },
  })
  const slug = await uniqueSlugInKb(db, input.knowledgeBaseId, home?.slug ?? input.articleId)
  const parentPlacementId = input.parentPlacementId ?? null
  const sortOrder =
    input.sortOrder ??
    (await getNextPlacementSortOrder(db, input.knowledgeBaseId, parentPlacementId))

  const [placement] = await db
    .insert(schema.ArticlePlacement)
    .values({
      organizationId: ctx.organizationId,
      articleId: input.articleId,
      knowledgeBaseId: input.knowledgeBaseId,
      slug,
      parentId: parentPlacementId,
      sortOrder,
      isPublished: input.isPublished ?? false,
      hasUnpublishedChanges: false,
      linkedFromSourceId: input.linkedFromSourceId ?? null,
      updatedAt: new Date(),
    })
    .returning()
  if (!placement) throw new Error('Failed to insert article placement')
  return placement
}
