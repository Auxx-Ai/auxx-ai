// packages/lib/src/inventory/builds/kind-conflict-mutations.ts
// The "Sold as-is too, keep it" flag on a kind conflict (plans/mrp/17-stock-setup-flow.md D3). No access checks.

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { type RecordId, toRecordId } from '../../resources/resource-id'
import { systemFields } from '../../resources/system-records'
import { guard } from './guard'

const FLAG_PICK = pickSystemAttributes(PART_FIELDS, ['part_kind_conflict_confirmed'] as const)

/** Mark each part's current kind as intended, so the conflict read and the backflush gate skip it. */
export async function confirmKindConflicts(
  db: Database,
  organizationId: string,
  userId: string,
  partIds: string[]
): Promise<Result<{ count: number }, Error>> {
  return guard(
    async () => {
      const unique = [...new Set(partIds.filter(Boolean))]
      if (unique.length === 0) return { count: 0 }
      const ctx = await systemFields(db, organizationId, 'part', FLAG_PICK)
      const flag = ctx?.fields.part_kind_conflict_confirmed
      if (!ctx || !flag) {
        throw new UnprocessableEntityError(
          'This organization has no kind confirmation field yet. Run the pending data migrations.'
        )
      }
      const crud = new UnifiedCrudHandler(organizationId, userId, db)
      const recordIds = unique.map((partId) => toRecordId(ctx.defId, partId) as RecordId)
      return crud.bulkSetFieldValue(recordIds, flag.id, true)
    },
    'Failed to confirm part kind conflicts',
    { organizationId, partIds: partIds.length }
  )
}

/**
 * Drop the confirmation on parts whose kind is being written. A raw delete, not a field write: it
 * runs inside the kind's own pre-hook, and absence already reads as "not confirmed".
 */
export async function clearKindConflictConfirmations(
  db: Database | Transaction,
  organizationId: string,
  partIds: readonly string[]
): Promise<void> {
  if (partIds.length === 0) return
  const ctx = await systemFields(db, organizationId, 'part', FLAG_PICK)
  const flag = ctx?.fields.part_kind_conflict_confirmed
  if (!flag) return
  await db
    .delete(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, flag.id),
        inArray(schema.FieldValue.entityId, [...partIds])
      )
    )
}
