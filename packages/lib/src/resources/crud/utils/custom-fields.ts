// packages/lib/src/resources/crud/utils/custom-fields.ts

import type { RecordId } from '@auxx/types/resource'
import { FieldValueService } from '../../../field-values'
import type { CrudContext } from '../types'

/**
 * Set custom field values in batch for an entity.
 * Uses FieldValueService.setValuesForEntity() for efficiency.
 *
 * @param recordId - Full RecordId (entityDefinitionId:entityInstanceId)
 * @param customFields - Custom field values keyed by field ID
 * @param ctx - CRUD context with db, organizationId, userId
 */
export async function setCustomFields(
  recordId: RecordId,
  customFields: Record<string, unknown>,
  ctx: CrudContext
): Promise<void> {
  const entries = Object.entries(customFields).filter(
    ([_, value]) => value !== null && value !== undefined && value !== ''
  )

  if (entries.length === 0) return

  const service = new FieldValueService(ctx.organizationId, ctx.userId ?? '', ctx.db)

  await service.setValuesForEntity({
    recordId,
    values: entries.map(([fieldId, value]) => ({ fieldId, value })),
  })
}
