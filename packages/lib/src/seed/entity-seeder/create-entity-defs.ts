// packages/lib/src/seed/entity-seeder/create-entity-defs.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { EntityDefMap } from './types'
import { SYSTEM_ENTITIES } from './constants'

const logger = createScopedLogger('entity-seeder:create-entity-defs')

/**
 * Pass 1: Create EntityDefinitions
 * Creates all EntityDefinition records first. No dependencies on other passes.
 */
export async function createEntityDefinitions(
  db: Database,
  organizationId: string
): Promise<EntityDefMap> {
  const entityDefMap: EntityDefMap = new Map()
  const now = new Date()

  for (const entity of SYSTEM_ENTITIES) {
    const [created] = await db
      .insert(schema.EntityDefinition)
      .values({
        organizationId,
        entityType: entity.entityType,
        apiSlug: entity.apiSlug,
        singular: entity.singular,
        plural: entity.plural,
        icon: entity.icon,
        color: entity.color,
        updatedAt: now,
      })
      .returning()

    if (!created) {
      throw new Error(`Failed to create EntityDefinition for ${entity.entityType}`)
    }

    entityDefMap.set(entity.entityType, {
      id: created.id,
      entityType: entity.entityType,
      apiSlug: entity.apiSlug,
      singular: entity.singular,
      plural: entity.plural,
      icon: entity.icon,
      color: entity.color,
    })

    logger.debug(`Created EntityDefinition: ${entity.entityType}`, { id: created.id })
  }

  return entityDefMap
}
