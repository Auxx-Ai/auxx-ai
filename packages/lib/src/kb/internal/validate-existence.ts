// @auxx/lib/kb/internal/validate-existence.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { ArticleKind } from '@auxx/database/enums'
import type { ArticleKind as ArticleKindType } from '@auxx/database/types'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { createNotFoundError } from './errors'

type Db = Database | Transaction
type KnowledgeBase = typeof schema.KnowledgeBase.$inferSelect
type ArticleRow = typeof schema.Article.$inferSelect

/** A resolved parent placement + the parent article's kind (for kind rules). */
export interface ParentPlacement {
  placementId: string
  articleKind: ArticleKindType
}

export async function verifyKnowledgeBaseExists(
  db: Db,
  organizationId: string,
  id: string
): Promise<KnowledgeBase> {
  const knowledgeBase = await db.query.KnowledgeBase.findFirst({
    where: and(
      eq(schema.KnowledgeBase.id, id),
      eq(schema.KnowledgeBase.organizationId, organizationId)
    ),
  })
  if (!knowledgeBase) throw createNotFoundError(`Knowledge base with ID '${id}' not found`)
  return knowledgeBase
}

export async function verifyArticleExists(
  db: Db,
  organizationId: string,
  id: string
): Promise<ArticleRow> {
  const article = await db.query.Article.findFirst({
    where: and(eq(schema.Article.id, id), eq(schema.Article.organizationId, organizationId)),
  })
  if (!article) throw createNotFoundError(`Article with ID '${id}' not found`)
  return article
}

/**
 * Resolve a parent by its *article* id within a KB (the frontend addresses
 * parents in article-id space). Returns the parent placement id + the parent
 * article's kind. Relies on ≤1 placement per (article, KB).
 */
export async function verifyParentArticleExists(
  db: Db,
  parentArticleId: string,
  knowledgeBaseId: string
): Promise<ParentPlacement> {
  const parent = await db.query.ArticlePlacement.findFirst({
    where: and(
      eq(schema.ArticlePlacement.articleId, parentArticleId),
      eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId)
    ),
    columns: { id: true },
    with: { article: { columns: { articleKind: true } } },
  })
  if (!parent) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Parent article with ID '${parentArticleId}' not found`,
    })
  }
  return { placementId: parent.id, articleKind: parent.article.articleKind }
}

/**
 * Tabs are root-only. Tabs are optional: pages, categories, and headers may
 * sit at the KB root (`parent === null`) when no tabs exist. Headers may
 * only sit at the root or directly under a tab — never nested inside other
 * containers.
 */
export function validateArticleKind(kind: ArticleKindType, parent: ParentPlacement | null): void {
  if (kind === ArticleKind.tab) {
    if (parent !== null) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Tabs are root-level only and cannot have a parent.',
      })
    }
    return
  }
  if (kind === ArticleKind.header && parent !== null && parent.articleKind !== ArticleKind.tab) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Section headers can only sit at the KB root or directly under a tab.',
    })
  }
}
