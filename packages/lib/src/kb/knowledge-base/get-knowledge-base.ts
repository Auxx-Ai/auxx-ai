// @auxx/lib/kb/knowledge-base/get-knowledge-base.ts
import { schema } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'
import { resolveDb } from '../internal/context'
import { createNotFoundError, handleError } from '../internal/errors'
import type { KBContext } from '../types'

type KnowledgeBase = typeof schema.KnowledgeBase.$inferSelect

export async function getKnowledgeBaseById(ctx: KBContext, id: string): Promise<KnowledgeBase> {
  const db = resolveDb(ctx)
  try {
    const knowledgeBase = await db.query.KnowledgeBase.findFirst({
      where: and(
        eq(schema.KnowledgeBase.id, id),
        eq(schema.KnowledgeBase.organizationId, ctx.organizationId)
      ),
    })
    if (!knowledgeBase) throw createNotFoundError(`Knowledge base with ID '${id}' not found`)
    return knowledgeBase
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error fetching knowledge base', {
      knowledgeBaseId: id,
    })
  }
}

export async function listKnowledgeBases(ctx: KBContext): Promise<KnowledgeBase[]> {
  const db = resolveDb(ctx)
  try {
    return await db.query.KnowledgeBase.findMany({
      where: eq(schema.KnowledgeBase.organizationId, ctx.organizationId),
      orderBy: asc(schema.KnowledgeBase.name),
    })
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error fetching knowledge bases')
  }
}
