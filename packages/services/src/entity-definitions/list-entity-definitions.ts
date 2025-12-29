// packages/services/src/entity-definitions/list-entity-definitions.ts

import { database } from '@auxx/database'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { EntityType } from '@auxx/database/types'

/**
 * List all entity definitions for an organization
 * Optionally filter by entityType
 * Excludes archived definitions by default
 */
export async function listEntityDefinitions(params: {
  organizationId: string
  entityType?: EntityType
  includeArchived?: boolean
}) {
  const { organizationId, entityType, includeArchived = false } = params

  const dbResult = await fromDatabase(
    database.query.EntityDefinition.findMany({
      where: (defs, { eq, and, isNull }) => {
        const conditions = [
          eq(defs.organizationId, organizationId),
          ...(entityType ? [eq(defs.entityType, entityType)] : []),
          ...(!includeArchived ? [isNull(defs.archivedAt)] : []),
        ]
        return and(...conditions)
      },
      orderBy: (defs, { asc }) => [asc(defs.singular)],
    }),
    'list-entity-definitions'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  return ok(dbResult.value)
}
