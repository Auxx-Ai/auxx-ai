// packages/services/src/entity-definitions/update-entity-definition.ts

import { database, EntityDefinition } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { getEntityDefinition } from './get-entity-definition'

/** Parameters for updating an entity definition */
export interface UpdateEntityDefinitionParams {
  id: string
  organizationId: string
  data: {
    icon?: string
    color?: string
    singular?: string
    plural?: string
    archivedAt?: Date | null
    /** Custom field ID to use as primary display name */
    primaryDisplayFieldId?: string | null
    /** Custom field ID to use as secondary info/subtitle */
    secondaryDisplayFieldId?: string | null
    /** Custom field ID to use as avatar/image URL */
    avatarFieldId?: string | null
  }
}

/**
 * Update an entity definition
 * Only allows updating: icon, singular, plural, archivedAt
 * Does NOT allow changing: apiSlug, entityType, standardType (immutable after creation)
 * Only updates fields that are explicitly provided in the data object
 */
export async function updateEntityDefinition(params: UpdateEntityDefinitionParams) {
  const { id, organizationId, data } = params

  // Verify entity exists and belongs to organization
  const existingResult = await getEntityDefinition({ id, organizationId })
  if (existingResult.isErr()) {
    return err(existingResult.error)
  }

  // Build update object with only provided fields
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  }

  if ('icon' in data) {
    updateData.icon = data.icon
  }
  if ('color' in data) {
    updateData.color = data.color
  }
  if ('singular' in data) {
    updateData.singular = data.singular
  }
  if ('plural' in data) {
    updateData.plural = data.plural
  }
  if ('archivedAt' in data) {
    updateData.archivedAt = data.archivedAt
  }
  if ('primaryDisplayFieldId' in data) {
    updateData.primaryDisplayFieldId = data.primaryDisplayFieldId
  }
  if ('secondaryDisplayFieldId' in data) {
    updateData.secondaryDisplayFieldId = data.secondaryDisplayFieldId
  }
  if ('avatarFieldId' in data) {
    updateData.avatarFieldId = data.avatarFieldId
  }

  const dbResult = await fromDatabase(
    database
      .update(EntityDefinition)
      .set(updateData)
      .where(and(eq(EntityDefinition.id, id), eq(EntityDefinition.organizationId, organizationId)))
      .returning(),
    'update-entity-definition'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const updated = dbResult.value[0]
  if (!updated) {
    return err({
      code: 'ENTITY_DEFINITION_NOT_FOUND' as const,
      message: `Entity definition not found: ${id}`,
      entityDefinitionId: id,
    })
  }

  return ok(updated)
}
