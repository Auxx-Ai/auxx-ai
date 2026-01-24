// packages/services/src/entity-definitions/create-entity-definition.ts

import { database, EntityDefinition } from '@auxx/database'
import { RESERVED_API_SLUGS } from '@auxx/config/client'
import { FieldType } from '@auxx/database/enums'
import { CREATED_BY_FIELD_CONFIG } from '@auxx/types/custom-field'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { checkSlugExists } from './check-slug-exists'
import { createCustomField } from '../custom-fields/create-field'
import type { EntityType, StandardType } from '@auxx/database/types'

/** Parameters for creating an entity definition */
export interface CreateEntityDefinitionParams {
  organizationId: string
  apiSlug: string
  icon: string
  singular: string
  plural: string
  entityType?: EntityType
  standardType?: StandardType
}

/**
 * Create a new entity definition
 * Validates slug uniqueness before creation
 */
export async function createEntityDefinition(params: CreateEntityDefinitionParams) {
  const { organizationId, apiSlug, icon, singular, plural, entityType, standardType } = params

  // Check if slug is reserved (system entity type)
  if (RESERVED_API_SLUGS.includes(apiSlug.toLowerCase() as any)) {
    return err({
      code: 'RESERVED_SLUG' as const,
      message: `The slug "${apiSlug}" is reserved for system entities and cannot be used`,
      slug: apiSlug,
      organizationId,
    })
  }

  // Check if slug already exists
  const slugCheck = await checkSlugExists({ slug: apiSlug, organizationId })
  if (slugCheck.isErr()) {
    return err(slugCheck.error)
  }

  if (slugCheck.value) {
    return err({
      code: 'SLUG_ALREADY_EXISTS' as const,
      message: `An entity with slug "${apiSlug}" already exists`,
      slug: apiSlug,
      organizationId,
    })
  }

  const dbResult = await fromDatabase(
    database
      .insert(EntityDefinition)
      .values({
        organizationId,
        apiSlug,
        icon,
        singular,
        plural,
        entityType: entityType ?? null,
        standardType: standardType ?? null,
        updatedAt: new Date(),
      })
      .returning(),
    'create-entity-definition'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const created = dbResult.value[0]
  if (!created) {
    return err({
      code: 'ENTITY_DEFINITION_NOT_FOUND' as const,
      message: 'Failed to create entity definition',
      entityDefinitionId: '',
    })
  }

  // Auto-create createdBy field for custom entities
  // This field is auto-populated by the system and cannot be manually set or modified
  await createCustomField({
    organizationId,
    entityDefinitionId: created.id,
    name: CREATED_BY_FIELD_CONFIG.name,
    type: FieldType.ACTOR,
    systemAttribute: CREATED_BY_FIELD_CONFIG.systemAttribute,
    isCustom: false,
    required: false,
    isCreatable: false,
    isUpdatable: false,
    options: {
      actor: CREATED_BY_FIELD_CONFIG.actorOptions,
    },
  })

  return ok(created)
}
