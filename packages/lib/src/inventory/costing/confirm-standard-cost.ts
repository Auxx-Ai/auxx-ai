// packages/lib/src/inventory/costing/confirm-standard-cost.ts

// Stamp the source and origin of standards that already exist, without touching the amount
// (plans/mrp/22 §3.3). No permission checks: the router asserts.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { setValueWithType } from '../../field-values/field-value-mutations'
import { toFieldType } from '../../field-values/stored-field-type'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../../realtime'
import type { StandardCostOriginValue } from './client'
import { guard } from './guard'
import { loadStandardCostWriteContext } from './standard-cost-queries'

const logger = createScopedLogger('costing:confirm-standard-cost')

/** One part to mark confirmed; `origin` also restamps where the cost came from. */
export interface ConfirmStandardCostEntry {
  partId: string
  origin?: StandardCostOriginValue
}

/**
 * Mark each named part's existing standard `confirmed`. A part with no standard, an unknown id
 * or a service is skipped. Returns the parts written.
 */
export async function confirmStandardCosts(
  db: Database,
  organizationId: string,
  entries: readonly ConfirmStandardCostEntry[]
): Promise<Result<string[], Error>> {
  return guard(
    async () => {
      if (entries.length === 0) return []
      const context = await loadStandardCostWriteContext(db, organizationId)
      const { fields, partDefId } = context
      if (!fields.source) return []

      const userId = await getOrgCache().get(organizationId, 'systemUser')
      const ctx = createFieldValueContext(organizationId, userId, db)
      const written: string[] = []
      const updates: FieldValueUpdateEntry[] = []
      const seen = new Set<string>()

      for (const entry of entries) {
        if (seen.has(entry.partId)) continue
        seen.add(entry.partId)
        if (context.standardCosts.get(entry.partId) == null) continue
        if (context.partKinds.get(entry.partId) === 'service') continue

        const recordId = toRecordId(partDefId, entry.partId) as RecordId
        const writes = [
          { field: fields.source, value: { type: 'option' as const, optionId: 'confirmed' } },
          ...(entry.origin && fields.origin
            ? [{ field: fields.origin, value: { type: 'option' as const, optionId: entry.origin } }]
            : []),
        ]
        try {
          for (const write of writes) {
            await setValueWithType(ctx, {
              recordId,
              fieldId: write.field.id,
              fieldType: toFieldType(write.field.type),
              value: write.value,
            })
            updates.push({
              key: buildFieldValueKey(recordId, write.field.id as FieldId),
              value: write.value as FieldValueUpdateEntry['value'],
            })
          }
          written.push(entry.partId)
        } catch (error) {
          logger.error('Failed to confirm a standard cost', {
            organizationId,
            partId: entry.partId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      if (updates.length > 0) {
        publishFieldValueUpdates(getRealtimeService(), organizationId, updates).catch(() => {})
      }
      return written
    },
    'Failed to confirm standard costs',
    { organizationId, entries: entries.length }
  )
}
