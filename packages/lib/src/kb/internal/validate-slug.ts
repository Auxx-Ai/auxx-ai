// @auxx/lib/kb/internal/validate-slug.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { TRPCError } from '@trpc/server'
import { and, eq, ne } from 'drizzle-orm'

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

export async function validateArticleSlugAvailability(
  db: Db,
  slug: string,
  knowledgeBaseId: string,
  excludeId?: string
): Promise<void> {
  const slugExists = await db.query.Article.findFirst({
    where: and(
      eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
      eq(schema.Article.slug, slug),
      excludeId ? ne(schema.Article.id, excludeId) : undefined
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
  excludeId?: string
): Promise<string> {
  const baseSlug = title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  let slug = baseSlug
  let counter = 1
  while (true) {
    const existing = await db.query.Article.findFirst({
      where: and(
        eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
        eq(schema.Article.slug, slug),
        excludeId ? ne(schema.Article.id, excludeId) : undefined
      ),
    })
    if (!existing) return slug
    slug = `${baseSlug}-${counter}`
    counter++
  }
}
