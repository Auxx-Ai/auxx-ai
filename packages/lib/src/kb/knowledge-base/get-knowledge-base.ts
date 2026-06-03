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
      // kind='source' KBs are hidden containers owned by KnowledgeSources — never
      // surfaced in KB lists, pickers, or the public site.
      where: and(
        eq(schema.KnowledgeBase.organizationId, ctx.organizationId),
        eq(schema.KnowledgeBase.kind, 'standard')
      ),
      orderBy: asc(schema.KnowledgeBase.name),
    })
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error fetching knowledge bases')
  }
}
