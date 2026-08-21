// packages/lib/src/custom-fields/count-option-usage.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import { and, count, eq, isNotNull, isNull } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, NotFoundError } from '../errors'
import { type FieldOptionItem, optionKey } from '../resources/registry/option-helpers'

/**
 * Count how many live records carry each option of one select/tag field.
 *
 * Backs the "used on N records" warning both option editors show before a
 * delete, so the answer must be the TRUE blast radius. It is therefore a raw
 * count and deliberately NOT routed through the aggregate engine
 * (`runAggregate` with `count` + `groupBy` would give the same numbers for
 * free): that path applies record scope, so an admin about to destroy an
 * option would be shown an understated count of what they are destroying.
 *
 * Every option of the field gets an entry, zero-filled — one round trip per
 * dialog lets both editors render a count inline next to each option rather
 * than only inside the confirm.
 *
 * The option list is read from the org cache: this is a pure read, so a
 * slightly stale list can only mis-label a count, never delete anything. (The
 * cascade in `updateCustomField` is the opposite case and must never use it.)
 *
 * @param db - Database or transaction handle
 * @param organizationId - Organization scope
 * @param resourceFieldId - `{entityDefinitionId}:{fieldId}` of the field
 * @returns A count per option key, keyed the way a `FieldValue` stores it
 */
export async function countOptionUsage(
  db: Database | Transaction,
  organizationId: string,
  resourceFieldId: ResourceFieldId
): Promise<Result<Record<string, number>, Error>> {
  const { entityDefinitionId, fieldId } = parseResourceFieldId(resourceFieldId)

  const { getCachedCustomFields } = await import('../cache')
  const fields = await getCachedCustomFields(organizationId, entityDefinitionId)
  const field = fields.find((f) => f.id === fieldId)
  if (!field) {
    return err(new NotFoundError('Field not found'))
  }

  // Zero-fill first so an option nobody uses still reports a count. Keyed by
  // `optionKey` (`id ?? value`) — what a write would have stored.
  const options = (field.options as { options?: FieldOptionItem[] } | null)?.options ?? []
  const counts: Record<string, number> = {}
  for (const option of options) {
    const key = optionKey(option)
    if (key) counts[key] = 0
  }

  try {
    const rows = await db
      .select({ optionId: schema.FieldValue.optionId, total: count() })
      .from(schema.FieldValue)
      .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.fieldId, fieldId),
          isNotNull(schema.FieldValue.optionId),
          isNull(schema.EntityInstance.archivedAt)
        )
      )
      .groupBy(schema.FieldValue.optionId)

    for (const row of rows) {
      if (!row.optionId) continue
      // A stored id that resolves to no current option (an orphan, or a
      // label-shaped write-path fallback) is reported under its raw key rather
      // than dropped — the editors need to see that it exists.
      counts[row.optionId] = (counts[row.optionId] ?? 0) + row.total
    }

    return ok(counts)
  } catch (error) {
    return err(
      new AuxxError('Failed to count option usage', {
        cause: error instanceof Error ? error.message : String(error),
      })
    )
  }
}
