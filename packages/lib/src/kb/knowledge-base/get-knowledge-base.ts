// @auxx/lib/kb/knowledge-base/get-knowledge-base.ts
import { schema } from '@auxx/database'
import { and, asc, eq, inArray } from 'drizzle-orm'
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

/**
 * The org's member-facing knowledge bases (plan v3/06 §6.2 / P4).
 *
 * `kind: 'source'` KBs are excluded and always will be: they are hidden
 * containers owned by `KnowledgeSource` — never surfaced in KB lists, pickers,
 * or the public site. That exclusion is what the original `kind = 'standard'`
 * filter was actually protecting.
 *
 * `kind: 'learned'` (AI Memory) is INCLUDED, and used not to be. That was a
 * defect, not a policy: `kb.list` is the only surface that can render a Share
 * card, so while AI Memory was filtered out here **no `kb` `ResourceAccess` row
 * could be authored against it at all** and its access was decided entirely by
 * the coarse `knowledgeBase` area fallback. AI Memory is deliberately
 * member-facing — `ensureLearnedMemory` gates on `knowledgeBaseEdit` rather than
 * `knowledgeBaseManage` because it is "org knowledge every teammate can read and
 * correct".
 *
 * This widens **listing**, not access: `kb.list`'s caller filters every row
 * through `canViewInstance('kb', id)`.
 */
export async function listKnowledgeBases(ctx: KBContext): Promise<KnowledgeBase[]> {
  const db = resolveDb(ctx)
  try {
    return await db.query.KnowledgeBase.findMany({
      where: and(
        eq(schema.KnowledgeBase.organizationId, ctx.organizationId),
        inArray(schema.KnowledgeBase.kind, ['standard', 'learned'])
      ),
      orderBy: asc(schema.KnowledgeBase.name),
    })
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error fetching knowledge bases')
  }
}
