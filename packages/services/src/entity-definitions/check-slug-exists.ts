// packages/services/src/entity-definitions/check-slug-exists.ts

import { database } from '@auxx/database'
import { RESERVED_API_SLUGS } from '@auxx/config/client'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Check if an apiSlug already exists for the organization or is reserved
 * Useful for slug validation before creation
 */
export async function checkSlugExists(params: {
  slug: string
  organizationId: string
  excludeId?: string // For updates
}) {
  const { slug, organizationId, excludeId } = params

  // Check if slug is reserved (system entity type)
  if (RESERVED_API_SLUGS.includes(slug.toLowerCase() as any)) {
    return err({
      code: 'RESERVED_SLUG' as const,
      message: `The slug "${slug}" is reserved for system entities and cannot be used`,
      slug,
      organizationId,
    })
  }

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
