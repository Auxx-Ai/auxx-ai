// packages/lib/src/resources/crud/utils/custom-fields.ts

import { FieldValueService, type ModelType } from '../../../field-values'
import type { CrudContext } from '../types'

/**
 * Map resource type to FieldValueService model type
 */
function getModelType(resourceType: string): ModelType {
  switch (resourceType) {
    case 'contact':
      return 'contact'
    case 'ticket':
      return 'ticket'
    case 'thread':
      return 'thread'
    default:
      // Entity instances use 'entity'
      if (resourceType.startsWith('entity_')) {
        return 'entity'
      }
      return 'contact'
  }
}

/**
 * Set custom field values in batch for an entity.
 * Uses FieldValueService.setValuesForEntity() for efficiency.
 */
export async function setCustomFields(
  entityId: string,
  customFields: Record<string, unknown>,
  resourceType: string,
  ctx: CrudContext
): Promise<void> {
  const entries = Object.entries(customFields).filter(
    ([_, value]) => value !== null && value !== undefined && value !== ''
  )

  if (entries.length === 0) return

  const service = new FieldValueService(ctx.organizationId, ctx.userId ?? '', ctx.db)
  const modelType = getModelType(resourceType)

  await service.setValuesForEntity({
    entityId,
    values: entries.map(([fieldId, value]) => ({ fieldId, value })),
    modelType,
  })
}
