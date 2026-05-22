// @auxx/lib/kb/knowledge-base/delete-knowledge-base.ts
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { resolveDb } from '../internal/context'
import { handleError } from '../internal/errors'
import { verifyKnowledgeBaseExists } from '../internal/validate-existence'
import type { KBContext } from '../types'

export async function deleteKnowledgeBase(
  ctx: KBContext,
  id: string
): Promise<{ success: boolean }> {
  const db = resolveDb(ctx)
  try {
    await verifyKnowledgeBaseExists(db, ctx.organizationId, id)
    await db.delete(schema.KnowledgeBase).where(eq(schema.KnowledgeBase.id, id))
    return { success: true }
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error deleting knowledge base', {
      knowledgeBaseId: id,
    })
  }
}
