// packages/services/src/entity-instances/list-entity-instances.ts

import { database } from '@auxx/database'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/** Parameters for listing entity instances */
export interface ListEntityInstancesParams {
  organizationId: string
  entityDefinitionId: string
  includeArchived?: boolean
  limit?: number
  cursor?: string
}

/** Result type for paginated entity instance lists */
export interface ListEntityInstancesResult {
  items: Awaited<ReturnType<typeof database.query.EntityInstance.findMany>>
  nextCursor: string | undefined
}

/**
 * List entity instances for a specific entity definition with cursor-based pagination
 */
export async function listEntityInstances(params: ListEntityInstancesParams) {
  const { organizationId, entityDefinitionId, includeArchived = false, limit = 50, cursor } = params

  const dbResult = await fromDatabase(
    database.query.EntityInstance.findMany({
      where: (instances, { eq, and, isNull, or, sql }) => {
        const conditions = [
          eq(instances.organizationId, organizationId),
          eq(instances.entityDefinitionId, entityDefinitionId),
        ]
        if (!includeArchived) {
          conditions.push(isNull(instances.archivedAt))
        }
        // Cursor-based pagination: cursor format is "timestamp|id"
        if (cursor) {
          const [timestamp, id] = cursor.split('|')
          if (timestamp && id) {
            conditions.push(
              or(
                sql`${instances.updatedAt} < ${timestamp}`,
                and(sql`${instances.updatedAt} = ${timestamp}`, sql`${instances.id} < ${id}`)
              )!
            )
          }
        }
        return and(...conditions)
      },
      with: {
        typedValues: true,
      },
      orderBy: (instances, { desc }) => [desc(instances.updatedAt)],
      limit: limit + 1,
    }),
    'list-entity-instances'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const items = dbResult.value
  let nextCursor: string | undefined

  // If we got more items than the limit, there are more pages
  if (items.length > limit) {
    const next = items.pop()
    nextCursor = next ? `${next.updatedAt}|${next.id}` : undefined
  }

  return ok({ items, nextCursor })
}
