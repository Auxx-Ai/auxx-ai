// packages/lib/src/knowledge-sources/source-service.ts
// Functional CRUD for KnowledgeSource. Delete (publishable) hard-removes the managed
// subtree + its Documents while preserving any detached articles.

import { type Database, schema } from '@auxx/database'
import { generateId } from '@auxx/utils'
import { and, eq, inArray } from 'drizzle-orm'
import { DatasetService } from '../datasets/services/dataset-service'
import { NotFoundError } from '../errors'
import {
  createKnowledgeBase,
  ensureManagedDataset,
} from '../kb/knowledge-base/create-knowledge-base'
import { deleteKnowledgeBase } from '../kb/knowledge-base/delete-knowledge-base'
import type { ScheduledTriggerConfig } from '../workflows/cron-pattern'
import { removeSourceScheduler, syncSourceScheduler } from './source-scheduler'

export type KnowledgeSourceRow = typeof schema.KnowledgeSource.$inferSelect

export interface CreateSourceInput {
  name: string
  type: KnowledgeSourceRow['type']
  surface?: 'publishable' | 'ai-only'
  config?: Record<string, unknown>
  syncBehavior?: 'manual' | 'scheduled' | 'webhook'
  scheduleConfig?: ScheduledTriggerConfig | null
  createdById?: string | null
}

/**
 * Resolve a non-null creator for the owned source-KB (KnowledgeBase.createdById is
 * NOT NULL). Sources created via tRPC always carry the session user; the fallback
 * covers headless callers (smoke test / future webhooks).
 */
async function resolveCreatorId(
  db: Database,
  organizationId: string,
  createdById?: string | null
): Promise<string> {
  if (createdById) return createdById
  const member = await db.query.OrganizationMember.findFirst({
    where: eq(schema.OrganizationMember.organizationId, organizationId),
    columns: { userId: true },
  })
  if (!member) throw new NotFoundError(`No members found for organization '${organizationId}'`)
  return member.userId
}

async function loadSource(
  db: Database,
  organizationId: string,
  sourceId: string
): Promise<KnowledgeSourceRow> {
  const source = await db.query.KnowledgeSource.findFirst({
    where: and(
      eq(schema.KnowledgeSource.id, sourceId),
      eq(schema.KnowledgeSource.organizationId, organizationId)
    ),
  })
  if (!source) throw new NotFoundError(`Knowledge source '${sourceId}' not found`)
  return source
}

export async function createSource(
  db: Database,
  organizationId: string,
  input: CreateSourceInput
): Promise<KnowledgeSourceRow> {
  const creatorId = await resolveCreatorId(db, organizationId, input.createdById)

  // A source owns a hidden KB (kind='source'): its synced articles home + embed here,
  // then link into user-facing KBs. INTERNAL + DRAFT so it can never leak to the public
  // site; the `__source-` slug keeps it out of any human slug space.
  const ownedKb = await createKnowledgeBase(
    { db, organizationId },
    {
      name: input.name,
      slug: `__source-${generateId()}`,
      kind: 'source',
      visibility: 'INTERNAL',
      publishStatus: 'DRAFT',
    },
    creatorId
  )
  // Awaited (createKnowledgeBase fires this best-effort/async) so the first sync, which
  // embeds immediately, always has a dataset to write into.
  await ensureManagedDataset({ db, organizationId }, ownedKb, creatorId)

  const [row] = await db
    .insert(schema.KnowledgeSource)
    .values({
      organizationId,
      type: input.type,
      name: input.name,
      surface: input.surface ?? 'publishable',
      config: input.config ?? {},
      ownedKnowledgeBaseId: ownedKb.id,
      syncBehavior: input.syncBehavior ?? 'manual',
      scheduleConfig: input.scheduleConfig ?? null,
      status: 'pending',
      createdById: input.createdById ?? null,
      updatedAt: new Date(),
    })
    .returning()
  if (!row) throw new Error('Failed to create knowledge source')
  await syncSourceScheduler(row)
  return row
}

export async function listSources(
  db: Database,
  organizationId: string
): Promise<KnowledgeSourceRow[]> {
  return db.query.KnowledgeSource.findMany({
    where: eq(schema.KnowledgeSource.organizationId, organizationId),
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  })
}

export async function getSource(
  db: Database,
  organizationId: string,
  sourceId: string
): Promise<KnowledgeSourceRow> {
  return loadSource(db, organizationId, sourceId)
}

export async function updateSource(
  db: Database,
  organizationId: string,
  sourceId: string,
  patch: Partial<
    Pick<KnowledgeSourceRow, 'name' | 'config' | 'syncBehavior' | 'status' | 'scheduleConfig'>
  >
): Promise<KnowledgeSourceRow> {
  await loadSource(db, organizationId, sourceId)
  const [row] = await db
    .update(schema.KnowledgeSource)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.KnowledgeSource.id, sourceId))
    .returning()
  if (!row) throw new Error('Failed to update knowledge source')
  // Re-register/remove the scheduler to match the (possibly changed) cadence.
  await syncSourceScheduler(row)
  return row
}

/** Pause a source: stop scheduled fires without losing the configured cadence. */
export async function pauseSource(
  db: Database,
  organizationId: string,
  sourceId: string
): Promise<KnowledgeSourceRow> {
  await loadSource(db, organizationId, sourceId)
  const [row] = await db
    .update(schema.KnowledgeSource)
    .set({ status: 'paused', updatedAt: new Date() })
    .where(eq(schema.KnowledgeSource.id, sourceId))
    .returning()
  if (!row) throw new Error('Failed to pause knowledge source')
  await removeSourceScheduler(sourceId)
  return row
}

/** Resume a paused source: re-register its scheduler if one is configured. */
export async function resumeSource(
  db: Database,
  organizationId: string,
  sourceId: string
): Promise<KnowledgeSourceRow> {
  await loadSource(db, organizationId, sourceId)
  const [row] = await db
    .update(schema.KnowledgeSource)
    .set({ status: 'live', updatedAt: new Date() })
    .where(eq(schema.KnowledgeSource.id, sourceId))
    .returning()
  if (!row) throw new Error('Failed to resume knowledge source')
  await syncSourceScheduler(row)
  return row
}

/**
 * Delete a source: removes its owned (hidden) KnowledgeBase and everything homed in it —
 * managed **and** detached articles, their placements (including links into user KBs),
 * and the owned dataset's embedding Documents. Deleting a source is total; "detach" only
 * unlocks editing while the source still exists.
 */
export async function deleteSource(
  db: Database,
  organizationId: string,
  sourceId: string
): Promise<{ success: boolean }> {
  const source = await loadSource(db, organizationId, sourceId)

  // Drop the scheduler before the row goes, so no fire can land mid-delete.
  await removeSourceScheduler(sourceId)

  const articles = await db.query.Article.findMany({
    where: and(
      eq(schema.Article.organizationId, organizationId),
      eq(schema.Article.sourceId, sourceId)
    ),
    columns: { id: true },
  })
  const articleIds = articles.map((a) => a.id)

  await db.transaction(async (tx) => {
    if (articleIds.length > 0) {
      // Clear the circular Article<->ArticleRevision FK before deleting the content; the
      // delete then cascades every placement (home + links) and revision.
      await tx
        .update(schema.ArticlePlacement)
        .set({ publishedRevisionId: null })
        .where(inArray(schema.ArticlePlacement.articleId, articleIds))
      await tx
        .update(schema.Article)
        .set({ draftRevisionId: null })
        .where(inArray(schema.Article.id, articleIds))
      await tx.delete(schema.Article).where(inArray(schema.Article.id, articleIds))
    }
    await tx.delete(schema.KnowledgeSource).where(eq(schema.KnowledgeSource.id, sourceId))
  })

  // Drop the owned KB + its managed dataset (cascades the embedding Documents).
  const ownedKb = await db.query.KnowledgeBase.findFirst({
    where: eq(schema.KnowledgeBase.id, source.ownedKnowledgeBaseId),
    columns: { id: true, datasetId: true },
  })
  if (ownedKb?.datasetId) {
    await new DatasetService(db).delete(ownedKb.datasetId, organizationId)
  }
  await deleteKnowledgeBase({ db, organizationId }, source.ownedKnowledgeBaseId)

  return { success: true }
}
