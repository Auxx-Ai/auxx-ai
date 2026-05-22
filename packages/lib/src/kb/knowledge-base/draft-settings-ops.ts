// @auxx/lib/kb/knowledge-base/draft-settings-ops.ts
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { KBDraftSettings } from '../draft-settings'
import { resolveDb } from '../internal/context'
import { handleError } from '../internal/errors'
import { verifyKnowledgeBaseExists } from '../internal/validate-existence'
import type { KBContext } from '../types'

type KnowledgeBase = typeof schema.KnowledgeBase.$inferSelect

/**
 * Shallow-merge `patch` into the KB's `draftSettings` JSON. Never touches
 * flat columns. Public visitors continue to see whatever's on the row.
 */
export async function updateDraftSettings(
  ctx: KBContext,
  id: string,
  patch: KBDraftSettings
): Promise<KnowledgeBase> {
  const db = resolveDb(ctx)
  try {
    if (Object.keys(patch).length === 0) {
      return await verifyKnowledgeBaseExists(db, ctx.organizationId, id)
    }
    const existing = await verifyKnowledgeBaseExists(db, ctx.organizationId, id)
    const nextDraft: KBDraftSettings = {
      ...((existing.draftSettings as KBDraftSettings | null) ?? {}),
      ...patch,
    }
    const [updated] = await db
      .update(schema.KnowledgeBase)
      .set({ draftSettings: nextDraft, updatedAt: new Date() })
      .where(eq(schema.KnowledgeBase.id, id))
      .returning()
    return updated
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error updating KB draft settings', { id })
  }
}

/**
 * Apply pending `draftSettings` onto the live columns and clear the JSON.
 * No-op if there's no pending draft.
 */
export async function publishPendingSettings(ctx: KBContext, id: string): Promise<KnowledgeBase> {
  const db = resolveDb(ctx)
  try {
    const kb = await verifyKnowledgeBaseExists(db, ctx.organizationId, id)
    const draft = kb.draftSettings as KBDraftSettings | null
    if (!draft || Object.keys(draft).length === 0) return kb
    const [updated] = await db
      .update(schema.KnowledgeBase)
      .set({ ...draft, draftSettings: null, updatedAt: new Date() })
      .where(eq(schema.KnowledgeBase.id, id))
      .returning()
    return updated
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error publishing KB draft settings', { id })
  }
}

/** Drop the pending draft. Live columns are untouched. */
export async function discardSettingsDraft(ctx: KBContext, id: string): Promise<KnowledgeBase> {
  const db = resolveDb(ctx)
  try {
    await verifyKnowledgeBaseExists(db, ctx.organizationId, id)
    const [updated] = await db
      .update(schema.KnowledgeBase)
      .set({ draftSettings: null, updatedAt: new Date() })
      .where(eq(schema.KnowledgeBase.id, id))
      .returning()
    return updated
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error discarding KB draft settings', { id })
  }
}
