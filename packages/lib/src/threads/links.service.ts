// packages/lib/src/threads/links.service.ts

import { type Database, database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'

type DbOrTx = Database | Transaction

const logger = createScopedLogger('thread-links-service')

export type LinkRole = 'primary' | 'secondary'

export interface LinkEntityToThreadParams {
  threadId: string
  entityInstanceId: string
  role: LinkRole
  organizationId: string
  actorId?: string | null
}

export interface ThreadWorkItem {
  entityInstanceId: string
  entityDefinitionId: string
  /** EntityDefinition.apiSlug — useful for UI keying. */
  entitySlug: string
  role: LinkRole
}

/**
 * Service for managing the multi-entity link surface on a Thread.
 *
 * One Thread has at most one primary EntityInstance (stored on Thread itself
 * via `primaryEntityInstanceId` + `primaryEntityDefinitionId`). Any additional
 * entity associations live in {@link schema.ThreadEntityLink} as secondaries.
 *
 * Invariants enforced here:
 * - `primaryEntityDefinitionId` is always read from EntityInstance, never
 *   trusted from caller input. Prevents drift between the two columns.
 * - Promoting a new primary demotes the existing primary to a secondary in
 *   the same transaction (no orphan windows).
 * - Primary unlink is refused — caller must demote (or reassign) first.
 */

/**
 * Link an EntityInstance to a Thread. If `role === 'primary'` and the thread
 * already has a primary, that primary is moved to a secondary in the same tx.
 */
export async function linkEntityToThread(
  params: LinkEntityToThreadParams,
  tx?: DbOrTx
): Promise<void> {
  const { threadId, entityInstanceId, role, organizationId, actorId } = params
  const db = tx ?? database

  await db.transaction(async (trx) => {
    // Resolve entityDefinitionId from EntityInstance — never from caller input.
    const [entity] = await trx
      .select({
        id: schema.EntityInstance.id,
        definitionId: schema.EntityInstance.entityDefinitionId,
      })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.id, entityInstanceId),
          eq(schema.EntityInstance.organizationId, organizationId)
        )
      )
      .limit(1)

    if (!entity) {
      throw new Error(`EntityInstance ${entityInstanceId} not found in org ${organizationId}`)
    }

    const [thread] = await trx
      .select({
        id: schema.Thread.id,
        primaryInstanceId: schema.Thread.primaryEntityInstanceId,
        primaryDefinitionId: schema.Thread.primaryEntityDefinitionId,
      })
      .from(schema.Thread)
      .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
      .limit(1)

    if (!thread) {
      throw new Error(`Thread ${threadId} not found in org ${organizationId}`)
    }

    if (role === 'primary') {
      // Demote existing primary (if any AND different) into a secondary.
      if (thread.primaryInstanceId && thread.primaryInstanceId !== entityInstanceId) {
        await upsertSecondaryLink(trx, {
          threadId,
          entityInstanceId: thread.primaryInstanceId,
          entityDefinitionId: thread.primaryDefinitionId ?? entity.definitionId,
          organizationId,
          actorId: actorId ?? null,
        })
      }

      await trx
        .update(schema.Thread)
        .set({
          primaryEntityInstanceId: entityInstanceId,
          primaryEntityDefinitionId: entity.definitionId,
        })
        .where(
          and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId))
        )

      // If the new primary was previously a secondary, soft-delete that row to
      // keep the unique-active invariant.
      await trx
        .update(schema.ThreadEntityLink)
        .set({ unlinkedAt: new Date() })
        .where(
          and(
            eq(schema.ThreadEntityLink.threadId, threadId),
            eq(schema.ThreadEntityLink.entityInstanceId, entityInstanceId),
            eq(schema.ThreadEntityLink.organizationId, organizationId),
            isNull(schema.ThreadEntityLink.unlinkedAt)
          )
        )
      return
    }

    // role === 'secondary'
    if (thread.primaryInstanceId === entityInstanceId) {
      // Already the primary — no-op rather than silently demoting.
      logger.debug('Skipping secondary link: entity is already primary', {
        threadId,
        entityInstanceId,
      })
      return
    }

    await upsertSecondaryLink(trx, {
      threadId,
      entityInstanceId,
      entityDefinitionId: entity.definitionId,
      organizationId,
      actorId: actorId ?? null,
    })
  })
}

/**
 * Soft-delete a thread→entity link.
 *
 * Refuses to unlink the primary — caller must promote a different entity to
 * primary first (or call {@link clearPrimaryEntity}).
 */
export async function unlinkEntity(
  params: {
    threadId: string
    entityInstanceId: string
    organizationId: string
  },
  tx?: DbOrTx
): Promise<void> {
  const { threadId, entityInstanceId, organizationId } = params
  const db = tx ?? database

  await db.transaction(async (trx) => {
    const [thread] = await trx
      .select({ primaryInstanceId: schema.Thread.primaryEntityInstanceId })
      .from(schema.Thread)
      .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
      .limit(1)

    if (thread?.primaryInstanceId === entityInstanceId) {
      throw new Error(
        `Refusing to unlink primary entity. Promote a different entity to primary first, or call clearPrimaryEntity().`
      )
    }

    await trx
      .update(schema.ThreadEntityLink)
      .set({ unlinkedAt: new Date() })
      .where(
        and(
          eq(schema.ThreadEntityLink.threadId, threadId),
          eq(schema.ThreadEntityLink.entityInstanceId, entityInstanceId),
          eq(schema.ThreadEntityLink.organizationId, organizationId),
          isNull(schema.ThreadEntityLink.unlinkedAt)
        )
      )
  })
}

/**
 * Clear the primary entity from a thread (without promoting another). The
 * existing primary is demoted to a secondary so the relationship survives.
 */
export async function clearPrimaryEntity(
  params: { threadId: string; organizationId: string; actorId?: string | null },
  tx?: DbOrTx
): Promise<void> {
  const { threadId, organizationId, actorId } = params
  const db = tx ?? database

  await db.transaction(async (trx) => {
    const [thread] = await trx
      .select({
        primaryInstanceId: schema.Thread.primaryEntityInstanceId,
        primaryDefinitionId: schema.Thread.primaryEntityDefinitionId,
      })
      .from(schema.Thread)
      .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
      .limit(1)

    if (!thread || !thread.primaryInstanceId || !thread.primaryDefinitionId) return

    await upsertSecondaryLink(trx, {
      threadId,
      entityInstanceId: thread.primaryInstanceId,
      entityDefinitionId: thread.primaryDefinitionId,
      organizationId,
      actorId: actorId ?? null,
    })

    await trx
      .update(schema.Thread)
      .set({ primaryEntityInstanceId: null, primaryEntityDefinitionId: null })
      .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
  })
}

/**
 * Return primary + active secondaries for a thread, with definition slugs.
 */
export async function getWorkItemsForThread(
  threadId: string,
  organizationId: string,
  tx?: DbOrTx
): Promise<ThreadWorkItem[]> {
  const db = tx ?? database

  const [primaryRow, secondaryRows] = await Promise.all([
    db
      .select({
        instanceId: schema.Thread.primaryEntityInstanceId,
        definitionId: schema.Thread.primaryEntityDefinitionId,
        slug: schema.EntityDefinition.apiSlug,
      })
      .from(schema.Thread)
      .leftJoin(
        schema.EntityDefinition,
        eq(schema.Thread.primaryEntityDefinitionId, schema.EntityDefinition.id)
      )
      .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
      .limit(1),
    db
      .select({
        instanceId: schema.ThreadEntityLink.entityInstanceId,
        definitionId: schema.ThreadEntityLink.entityDefinitionId,
        slug: schema.EntityDefinition.apiSlug,
      })
      .from(schema.ThreadEntityLink)
      .leftJoin(
        schema.EntityDefinition,
        eq(schema.ThreadEntityLink.entityDefinitionId, schema.EntityDefinition.id)
      )
      .where(
        and(
          eq(schema.ThreadEntityLink.threadId, threadId),
          eq(schema.ThreadEntityLink.organizationId, organizationId),
          isNull(schema.ThreadEntityLink.unlinkedAt)
        )
      ),
  ])

  const items: ThreadWorkItem[] = []
  const primary = primaryRow[0]
  if (primary?.instanceId && primary.definitionId) {
    items.push({
      entityInstanceId: primary.instanceId,
      entityDefinitionId: primary.definitionId,
      entitySlug: primary.slug ?? '',
      role: 'primary',
    })
  }
  for (const s of secondaryRows) {
    if (!s.instanceId || !s.definitionId) continue
    items.push({
      entityInstanceId: s.instanceId,
      entityDefinitionId: s.definitionId,
      entitySlug: s.slug ?? '',
      role: 'secondary',
    })
  }
  return items
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function upsertSecondaryLink(
  trx: Database,
  params: {
    threadId: string
    entityInstanceId: string
    entityDefinitionId: string
    organizationId: string
    actorId: string | null
  }
): Promise<void> {
  const { threadId, entityInstanceId, entityDefinitionId, organizationId, actorId } = params

  // Resurrect any soft-deleted prior link, otherwise insert a fresh one.
  const updated = await trx
    .update(schema.ThreadEntityLink)
    .set({ unlinkedAt: null, entityDefinitionId, createdById: actorId ?? null })
    .where(
      and(
        eq(schema.ThreadEntityLink.threadId, threadId),
        eq(schema.ThreadEntityLink.entityInstanceId, entityInstanceId),
        eq(schema.ThreadEntityLink.organizationId, organizationId)
      )
    )
    .returning({ id: schema.ThreadEntityLink.id })

  if (updated.length > 0) return

  await trx.insert(schema.ThreadEntityLink).values({
    threadId,
    entityInstanceId,
    entityDefinitionId,
    organizationId,
    createdById: actorId ?? null,
  })
}
