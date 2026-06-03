// @auxx/lib/kb/internal/validate-slug.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { TRPCError } from '@trpc/server'
import { and, eq, like, ne } from 'drizzle-orm'

type Db = Database | Transaction

export async function validateSlugAvailability(
  db: Db,
  organizationId: string,
  slug: string,
  excludeId?: string
): Promise<void> {
  const existingKb = await db.query.KnowledgeBase.findFirst({
    where: and(
      eq(schema.KnowledgeBase.organizationId, organizationId),
      eq(schema.KnowledgeBase.slug, slug),
      excludeId ? ne(schema.KnowledgeBase.id, excludeId) : undefined
    ),
    columns: { id: true },
  })
  if (existingKb) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `A knowledge base with slug '${slug}' already exists`,
    })
  }
}

/**
 * Slug uniqueness is per-KB and now enforced on placements
 * (`unique(knowledgeBaseId, slug)`). `excludeArticleId` skips the given
 * article's own placement so renaming an existing article doesn't collide
 * with itself.
 */
export async function validateArticleSlugAvailability(
  db: Db,
  slug: string,
  knowledgeBaseId: string,
  excludeArticleId?: string
): Promise<void> {
  const slugExists = await db.query.ArticlePlacement.findFirst({
    where: and(
      eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId),
      eq(schema.ArticlePlacement.slug, slug),
      excludeArticleId ? ne(schema.ArticlePlacement.articleId, excludeArticleId) : undefined
    ),
  })
  if (slugExists) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `An article with slug '${slug}' already exists in this knowledge base`,
    })
  }
}

export async function generateUniqueSlugFromTitle(
  db: Db,
  title: string,
  knowledgeBaseId: string,
  excludeArticleId?: string
): Promise<string> {
  const baseSlug = title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  // One query: pull every slug in this KB that could collide (the base slug or
  // a `base-N` suffix), then pick the first free suffix in memory instead of
  // probing the DB once per collision.
  const rows = await db.query.ArticlePlacement.findMany({
    where: and(
      eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId),
      like(schema.ArticlePlacement.slug, `${baseSlug}%`),
      excludeArticleId ? ne(schema.ArticlePlacement.articleId, excludeArticleId) : undefined
    ),
    columns: { slug: true },
  })
  const taken = new Set(rows.map((r) => r.slug))
  if (!taken.has(baseSlug)) return baseSlug
  let counter = 1
  while (taken.has(`${baseSlug}-${counter}`)) counter++
  return `${baseSlug}-${counter}`
}
