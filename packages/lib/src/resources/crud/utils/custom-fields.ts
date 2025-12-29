// packages/lib/src/resources/crud/utils/custom-fields.ts

import { CustomFieldService } from '../../../custom-fields'
import { ModelTypes, type ModelType } from '@auxx/services/custom-fields'
import type { CrudContext } from '../types'

/**
 * Map resource type to CustomFieldService model type
 */
function getModelType(resourceType: string): ModelType {
  switch (resourceType) {
    case 'contact':
      return ModelTypes.CONTACT
    case 'ticket':
      return ModelTypes.TICKET
    case 'thread':
      return ModelTypes.THREAD
    default:
      // Entity instances use ENTITY_INSTANCE
      if (resourceType.startsWith('entity_')) {
        return ModelTypes.ENTITY
      }
      return ModelTypes.CONTACT
  }
}

/**
 * Set custom field values in batch for an entity.
 * Uses CustomFieldService.setValues() for efficiency.
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

  const service = new CustomFieldService(ctx.organizationId, ctx.userId ?? '', ctx.db)
  const modelType = getModelType(resourceType)

  await service.setValues({
    entityId,
    values: entries.map(([fieldId, value]) => ({ fieldId, value })),
    modelType,
  })
}
