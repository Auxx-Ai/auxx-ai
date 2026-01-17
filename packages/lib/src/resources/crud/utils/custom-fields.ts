// packages/lib/src/resources/crud/utils/custom-fields.ts

import { FieldValueService } from '../../../field-values'
import type { ResourceId } from '@auxx/types/resource'
import type { CrudContext } from '../types'

/**
 * Set custom field values in batch for an entity.
 * Uses FieldValueService.setValuesForEntity() for efficiency.
 *
 * @param resourceId - Full ResourceId (entityDefinitionId:entityInstanceId)
 * @param customFields - Custom field values keyed by field ID
 * @param ctx - CRUD context with db, organizationId, userId
 */
export async function setCustomFields(
  resourceId: ResourceId,
  customFields: Record<string, unknown>,
  ctx: CrudContext
): Promise<void> {
  const entries = Object.entries(customFields).filter(
    ([_, value]) => value !== null && value !== undefined && value !== ''
  )

  if (entries.length === 0) return

  const service = new FieldValueService(ctx.organizationId, ctx.userId ?? '', ctx.db)

  await service.setValuesForEntity({
    resourceId,
    values: entries.map(([fieldId, value]) => ({ fieldId, value })),
  })
}
