// packages/services/src/entity-definitions/get-entity-definition-by-slug.ts

import { database } from '@auxx/database'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Get entity definition by apiSlug
 * Used for API routes and lookups
 */
export async function getEntityDefinitionBySlug(params: { slug: string; organizationId: string }) {
  const { slug, organizationId } = params

  const dbResult = await fromDatabase(
    database.query.EntityDefinition.findFirst({
      where: (defs, { eq, and, isNull }) =>
        and(eq(defs.apiSlug, slug), eq(defs.organizationId, organizationId), isNull(defs.archivedAt)),
    }),
    'get-entity-definition-by-slug'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const definition = dbResult.value

  if (!definition) {
    return err({
      code: 'ENTITY_DEFINITION_NOT_FOUND' as const,
      message: `Entity definition not found for slug: ${slug}`,
      entityDefinitionId: slug,
    })
  }

  return ok(definition)
}
