// packages/lib/src/field-values/relationship-queries.ts
// Query helpers for relationship fields stored in FieldValue table.
// Used by query builders to replace TagsOnThread junction table queries.

import { type Database, schema } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, isNotNull, type SQL, sql } from 'drizzle-orm'
import { ResourceRegistryService } from '../resources/registry/resource-registry-service'

/**
 * Build subquery to check if a thread has any tags.
 * Returns SQL subquery for use with EXISTS/NOT EXISTS.
 *
 * @param db - Database instance
 * @param threadIdExpr - SQL expression for thread ID (e.g., schema.Thread.id)
 * @param organizationId - Organization ID
 * @returns SQL subquery
 */
export function threadHasAnyTags(
  db: Database,
  threadIdExpr: SQL | typeof schema.Thread.id,
  organizationId: string
): SQL {
  return sql`EXISTS (
    SELECT 1
    FROM ${schema.FieldValue} fv
    INNER JOIN ${schema.CustomField} cf ON fv."fieldId" = cf.id
    INNER JOIN ${schema.EntityDefinition} ed ON cf."entityDefinitionId" = ed.id
    WHERE cf."systemAttribute" = 'thread_tags'
      AND ed."organizationId" = ${organizationId}
      AND fv."entityId" = ${threadIdExpr}
      AND fv."relatedEntityId" IS NOT NULL
  )`
}

/**
 * Build subquery to check if a thread does NOT have any tags.
 *
 * @param db - Database instance
 * @param threadIdExpr - SQL expression for thread ID
 * @param organizationId - Organization ID
 * @returns SQL subquery
 */
export function threadHasNoTags(
  db: Database,
  threadIdExpr: SQL | typeof schema.Thread.id,
  organizationId: string
): SQL {
  return sql`NOT EXISTS (
    SELECT 1
    FROM ${schema.FieldValue} fv
    INNER JOIN ${schema.CustomField} cf ON fv."fieldId" = cf.id
    INNER JOIN ${schema.EntityDefinition} ed ON cf."entityDefinitionId" = ed.id
    WHERE cf."systemAttribute" = 'thread_tags'
      AND ed."organizationId" = ${organizationId}
      AND fv."entityId" = ${threadIdExpr}
      AND fv."relatedEntityId" IS NOT NULL
  )`
}

/**
 * Build subquery to check if a thread has specific tag(s).
 * Returns SQL subquery for use with EXISTS.
 *
 * @param db - Database instance
 * @param threadIdExpr - SQL expression for thread ID
 * @param tagIds - Array of tag IDs to check
 * @param organizationId - Organization ID
 * @returns SQL subquery
 */
export function threadHasTags(
  db: Database,
  threadIdExpr: SQL | typeof schema.Thread.id,
  tagIds: string[],
  organizationId: string
): SQL {
  if (tagIds.length === 0) {
    return sql`FALSE`
  }

  if (tagIds.length === 1) {
    return sql`EXISTS (
      SELECT 1
      FROM ${schema.FieldValue} fv
      INNER JOIN ${schema.CustomField} cf ON fv."fieldId" = cf.id
      INNER JOIN ${schema.EntityDefinition} ed ON cf."entityDefinitionId" = ed.id
      WHERE cf."systemAttribute" = 'thread_tags'
        AND ed."organizationId" = ${organizationId}
        AND fv."entityId" = ${threadIdExpr}
        AND fv."relatedEntityId" = ${tagIds[0]}
    )`
  }

  return sql`EXISTS (
    SELECT 1
    FROM ${schema.FieldValue} fv
    INNER JOIN ${schema.CustomField} cf ON fv."fieldId" = cf.id
    INNER JOIN ${schema.EntityDefinition} ed ON cf."entityDefinitionId" = ed.id
    WHERE cf."systemAttribute" = 'thread_tags'
      AND ed."organizationId" = ${organizationId}
      AND fv."entityId" = ${threadIdExpr}
      AND fv."relatedEntityId" IN (${sql.join(
        tagIds.map((id) => sql`${id}`),
        sql`, `
      )})
  )`
}

/**
 * Build subquery to check if a thread does NOT have specific tag(s).
 *
 * @param db - Database instance
 * @param threadIdExpr - SQL expression for thread ID
 * @param tagIds - Array of tag IDs to exclude
 * @param organizationId - Organization ID
 * @returns SQL subquery
 */
export function threadDoesNotHaveTags(
  db: Database,
  threadIdExpr: SQL | typeof schema.Thread.id,
  tagIds: string[],
  organizationId: string
): SQL {
  if (tagIds.length === 0) {
    return sql`TRUE`
  }

  if (tagIds.length === 1) {
    return sql`NOT EXISTS (
      SELECT 1
      FROM ${schema.FieldValue} fv
      INNER JOIN ${schema.CustomField} cf ON fv."fieldId" = cf.id
      INNER JOIN ${schema.EntityDefinition} ed ON cf."entityDefinitionId" = ed.id
      WHERE cf."systemAttribute" = 'thread_tags'
        AND ed."organizationId" = ${organizationId}
        AND fv."entityId" = ${threadIdExpr}
        AND fv."relatedEntityId" = ${tagIds[0]}
    )`
  }

  return sql`NOT EXISTS (
    SELECT 1
    FROM ${schema.FieldValue} fv
    INNER JOIN ${schema.CustomField} cf ON fv."fieldId" = cf.id
    INNER JOIN ${schema.EntityDefinition} ed ON cf."entityDefinitionId" = ed.id
    WHERE cf."systemAttribute" = 'thread_tags'
      AND ed."organizationId" = ${organizationId}
      AND fv."entityId" = ${threadIdExpr}
      AND fv."relatedEntityId" IN (${sql.join(
        tagIds.map((id) => sql`${id}`),
        sql`, `
      )})
  )`
}

/**
 * Get all tag IDs for a thread.
 *
 * @param db - Database instance
 * @param threadId - Thread ID
 * @param organizationId - Organization ID
 * @returns Array of tag IDs
 */
export async function getThreadTagIds(
  db: Database,
  threadId: string,
  organizationId: string
): Promise<string[]> {
  const results = await db
    .select({ tagId: schema.FieldValue.relatedEntityId })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.CustomField.entityDefinitionId, schema.EntityDefinition.id)
    )
    .where(
      and(
        eq(schema.CustomField.systemAttribute, 'thread_tags'),
        eq(schema.EntityDefinition.organizationId, organizationId),
        eq(schema.FieldValue.entityId, threadId),
        isNotNull(schema.FieldValue.relatedEntityId)
      )
    )

  return results.map((r) => r.tagId).filter((id): id is string => id !== null)
}

/**
 * Batch get tag RecordIds for multiple threads.
 * Returns a Map of threadId -> array of RecordIds.
 *
 * Handles legacy data where relatedEntityId may be a raw instance ID
 * by normalizing to full RecordId format (entityDefinitionId:instanceId).
 *
 * @param db - Database instance
 * @param threadIds - Array of thread IDs
 * @param organizationId - Organization ID
 * @returns Map of threadId to RecordId[] array
 */
export async function batchGetThreadTagIds(
  db: Database,
  threadIds: string[],
  organizationId: string
): Promise<Map<string, string[]>> {
  if (threadIds.length === 0) {
    return new Map()
  }

  const registryService = new ResourceRegistryService(organizationId, db)

  // Get tag entityDefinitionId (cached) for normalizing legacy raw IDs
  const tagEntityDefId = await registryService.resolveEntityDefId('tag')

  // Get the thread_tags field ID for this organization
  const threadTagsField = await db.query.CustomField.findFirst({
    where: and(
      eq(schema.CustomField.systemAttribute, 'thread_tags'),
      eq(schema.CustomField.organizationId, organizationId)
    ),
    columns: { id: true },
  })
  if (!threadTagsField) {
    return new Map()
  }

  // Simple query: just FieldValue table, no JOINs needed
  const results = await db
    .select({
      threadId: schema.FieldValue.entityId,
      tagId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.fieldId, threadTagsField.id),
        inArray(schema.FieldValue.entityId, threadIds),
        isNotNull(schema.FieldValue.relatedEntityId)
      )
    )

  const map = new Map<string, string[]>()
  for (const { threadId, tagId } of results) {
    if (!threadId || !tagId) continue

    // Convert raw tag ID to RecordId format
    const recordId = toRecordId(tagEntityDefId, tagId)

    const existing = map.get(threadId) || []
    existing.push(recordId)
    map.set(threadId, existing)
  }
  return map
}

/**
 * Get threads that have a specific tag (for tag context filter).
 * Returns array of thread IDs.
 *
 * @param db - Database instance
 * @param tagId - Tag ID
 * @param organizationId - Organization ID
 * @returns Array of thread IDs that have this tag
 */
export async function getThreadsWithTag(
  db: Database,
  tagId: string,
  organizationId: string
): Promise<string[]> {
  const results = await db
    .select({ threadId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.CustomField.entityDefinitionId, schema.EntityDefinition.id)
    )
    .where(
      and(
        eq(schema.CustomField.systemAttribute, 'thread_tags'),
        eq(schema.EntityDefinition.organizationId, organizationId),
        eq(schema.FieldValue.relatedEntityId, tagId)
      )
    )

  return results.map((r) => r.threadId).filter((id): id is string => id !== null)
}

/**
 * Build a subquery to filter threads that have a tag matching a search term.
 * Used for "has:tag-name" search syntax.
 *
 * @param db - Database instance
 * @param threadIdExpr - SQL expression for thread ID
 * @param searchTerm - Tag name/title to search for
 * @param organizationId - Organization ID
 * @returns SQL subquery
 */
export function threadHasTagMatchingSearch(
  db: Database,
  threadIdExpr: SQL | typeof schema.Thread.id,
  searchTerm: string,
  organizationId: string
): SQL {
  const likeTerm = `%${searchTerm}%`
  return sql`EXISTS (
    SELECT 1
    FROM ${schema.FieldValue} fv
    INNER JOIN ${schema.CustomField} cf ON fv."fieldId" = cf.id
    INNER JOIN ${schema.EntityDefinition} ed ON cf."entityDefinitionId" = ed.id
    INNER JOIN ${schema.Tag} t ON fv."relatedEntityId" = t.id
    WHERE cf."systemAttribute" = 'thread_tags'
      AND ed."organizationId" = ${organizationId}
      AND fv."entityId" = ${threadIdExpr}
      AND (LOWER(t.title) LIKE LOWER(${likeTerm}) OR t.id = ${searchTerm})
  )`
}
