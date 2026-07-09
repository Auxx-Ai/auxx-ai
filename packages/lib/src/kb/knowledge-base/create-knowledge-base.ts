// @auxx/lib/kb/knowledge-base/create-knowledge-base.ts
import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { DatasetService } from '../../datasets/services/dataset-service'
import { resolveDb } from '../internal/context'
import { handleError, kbLogger as logger } from '../internal/errors'
import { validateSlugAvailability } from '../internal/validate-slug'
import type { KBContext, KBCreateInput } from '../types'

type KnowledgeBase = typeof schema.KnowledgeBase.$inferSelect

export async function createKnowledgeBase(
  ctx: KBContext,
  input: KBCreateInput,
  createdById: string
): Promise<KnowledgeBase> {
  const db = resolveDb(ctx)
  try {
    await validateSlugAvailability(db, ctx.organizationId, input.slug)
    const knowledgeBase = await db.transaction(async (tx) => {
      const [kb] = await tx
        .insert(schema.KnowledgeBase)
        .values({
          ...input,
          organizationId: ctx.organizationId,
          createdById,
          updatedAt: new Date(),
        })
        .returning()
      return kb
    })
    // Best-effort: provision the managed dataset that holds article embeddings.
    // First article publish will retry if this fails. Skipped for kind='source'
    // and kind='learned' KBs — createSource / ensureLearnedKb provision theirs
    // synchronously, and a fire-and-forget here would race that awaited call
    // (duplicate `__kb:<id>` dataset insert).
    if (knowledgeBase.kind === 'standard') {
      ensureManagedDataset(ctx, knowledgeBase, createdById).catch((error) => {
        logger.warn('Failed to provision managed dataset for new KB', {
          knowledgeBaseId: knowledgeBase.id,
          error: error instanceof Error ? error.message : error,
        })
      })
    }
    return knowledgeBase
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error creating knowledge base', { input })
  }
}

/**
 * Provision (or reuse) the managed dataset that backs this KB's embeddings.
 * Idempotent: returns the existing datasetId if it still resolves to a row,
 * otherwise creates a fresh `__kb:${kb.id}` dataset and writes it back to the
 * KnowledgeBase row.
 */
export async function ensureManagedDataset(
  ctx: KBContext,
  kb: KnowledgeBase,
  createdById: string
): Promise<string> {
  const db = resolveDb(ctx)
  if (kb.datasetId) {
    const existing = await db.query.Dataset.findFirst({
      where: and(
        eq(schema.Dataset.id, kb.datasetId),
        eq(schema.Dataset.organizationId, ctx.organizationId)
      ),
      columns: { id: true },
    })
    if (existing) return existing.id
  }

  const datasetService = new DatasetService(db)
  const dataset = await datasetService.create(ctx.organizationId, createdById, {
    name: `__kb:${kb.id}`,
    description: `Managed dataset for KB "${kb.name}"`,
    isManaged: true,
    chunkSettings: {
      strategy: 'FIXED_SIZE',
      size: 1024,
      overlap: 200,
      delimiter: '\n## ',
      preprocessing: {
        normalizeWhitespace: true,
        removeUrlsAndEmails: false,
      },
    },
  })

  await db
    .update(schema.KnowledgeBase)
    .set({ datasetId: dataset.id, updatedAt: new Date() })
    .where(eq(schema.KnowledgeBase.id, kb.id))

  return dataset.id
}
