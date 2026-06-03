// packages/lib/src/knowledge-sources/source-service.ts
// Functional CRUD for KnowledgeSource. Delete (publishable) hard-removes the managed
// subtree + its Documents while preserving any detached articles.

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { NotFoundError } from '../errors'
import { enqueueKBSync } from '../kb/kb-sync-queue'

export type KnowledgeSourceRow = typeof schema.KnowledgeSource.$inferSelect

export interface CreateSourceInput {
  name: string
  type: KnowledgeSourceRow['type']
  targetKnowledgeBaseId: string
  surface?: 'publishable' | 'ai-only'
  config?: Record<string, unknown>
  syncBehavior?: 'manual' | 'scheduled' | 'webhook'
  createdById?: string | null
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
  const [row] = await db
    .insert(schema.KnowledgeSource)
    .values({
      organizationId,
      type: input.type,
      name: input.name,
      surface: input.surface ?? 'publishable',
      config: input.config ?? {},
      targetKnowledgeBaseId: input.targetKnowledgeBaseId,
      syncBehavior: input.syncBehavior ?? 'manual',
      status: 'pending',
      createdById: input.createdById ?? null,
      updatedAt: new Date(),
    })
    .returning()
  if (!row) throw new Error('Failed to create knowledge source')
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
  return row
}

/**
 * Delete a source and its managed (publishable) content. Detached articles
 * (`managed=false`) survive: their placements are lifted to top-level first so the
 * managed-subtree cascade doesn't take them. Documents are dropped via kb-sync.
 */
export async function deleteSource(
  db: Database,
  organizationId: string,
  sourceId: string
): Promise<{ success: boolean }> {
  await loadSource(db, organizationId, sourceId)

  const managed = await db.query.Article.findMany({
    where: and(
      eq(schema.Article.organizationId, organizationId),
      eq(schema.Article.sourceId, sourceId),
      eq(schema.Article.managed, true)
    ),
    columns: { id: true, homeKnowledgeBaseId: true },
  })
  const detached = await db.query.Article.findMany({
    where: and(
      eq(schema.Article.organizationId, organizationId),
      eq(schema.Article.sourceId, sourceId),
      eq(schema.Article.managed, false)
    ),
    columns: { id: true },
  })
  const managedIds = managed.map((a) => a.id)
  const detachedIds = detached.map((a) => a.id)

  await db.transaction(async (tx) => {
    // Keep detached articles: lift their placements out of the managed subtree so
    // the parent-cascade delete below doesn't remove them.
    if (detachedIds.length > 0) {
      await tx
        .update(schema.ArticlePlacement)
        .set({ parentId: null, updatedAt: new Date() })
        .where(inArray(schema.ArticlePlacement.articleId, detachedIds))
    }
    if (managedIds.length > 0) {
      // Drop revision pointers first to clear the circular FK, then delete the
      // articles (cascades placements + revisions).
      await tx
        .update(schema.ArticlePlacement)
        .set({ publishedRevisionId: null })
        .where(inArray(schema.ArticlePlacement.articleId, managedIds))
      await tx
        .update(schema.Article)
        .set({ draftRevisionId: null })
        .where(inArray(schema.Article.id, managedIds))
      await tx.delete(schema.Article).where(inArray(schema.Article.id, managedIds))
    }
    await tx.delete(schema.KnowledgeSource).where(eq(schema.KnowledgeSource.id, sourceId))
  })

  // Drop the managed articles' Documents from the dataset (outside the tx).
  for (const article of managed) {
    void enqueueKBSync({
      type: 'delete',
      articleId: article.id,
      kbId: article.homeKnowledgeBaseId,
      organizationId,
    })
  }

  return { success: true }
}
