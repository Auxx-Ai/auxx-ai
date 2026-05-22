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

export async function verifyParentArticleExists(
  db: Db,
  parentId: string,
  knowledgeBaseId: string
): Promise<ArticleRow> {
  const parentExists = await db.query.Article.findFirst({
    where: and(
      eq(schema.Article.id, parentId),
      eq(schema.Article.knowledgeBaseId, knowledgeBaseId)
    ),
  })
  if (!parentExists) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Parent article with ID '${parentId}' not found`,
    })
  }
  return parentExists
}

/**
 * Tabs are root-only. Tabs are optional: pages, categories, and headers may
 * sit at the KB root (`parent === null`) when no tabs exist. Headers may
 * only sit at the root or directly under a tab — never nested inside other
 * containers.
 */
export function validateArticleKind(kind: ArticleKindType, parent: ArticleRow | null): void {
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
