// packages/services/src/entity-definitions/check-slug-exists.ts

import { database } from '@auxx/database'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Check if an apiSlug already exists for the organization
 * Useful for slug validation before creation
 */
export async function checkSlugExists(params: {
  slug: string
  organizationId: string
  excludeId?: string // For updates
}) {
  const { slug, organizationId, excludeId } = params

  const dbResult = await fromDatabase(
    database.query.EntityDefinition.findFirst({
      where: (defs, { eq, and, ne, isNull }) => {
        const conditions = [
          eq(defs.apiSlug, slug),
          eq(defs.organizationId, organizationId),
          isNull(defs.archivedAt),
        ]

        if (excludeId) {
          conditions.push(ne(defs.id, excludeId))
        }

        return and(...conditions)
      },
      columns: { id: true },
    }),
    'check-slug-exists'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  return ok(dbResult.value !== undefined && dbResult.value !== null)
}
