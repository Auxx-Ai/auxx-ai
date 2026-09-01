// packages/lib/src/field-hooks/post/part-kind-queries.ts

/**
 * The one lookup {@link derivePartKindForSubpartBatch} falls back to when a
 * subpart edge did not thread its parent in the create values.
 *
 * Its own module so `part-kind-derivation.ts` can stay free of a static Drizzle
 * import — the derivation is lazy-loaded from `system-entity-rules.ts` and that
 * file's header states the rule: keep the top-level graph light so registering a
 * trigger does not drag the query layer into every module that does it.
 */

import { database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'

/**
 * Parent `part` ids for a set of `subpart` instances, deduped, in one query.
 *
 * Soft-archive keeps `FieldValue` rows, so this resolves a deleted edge too —
 * not that the derivation runs on deletes (§4.3 decision 2), but the query has
 * no reason to be narrower than the table.
 */
export async function batchResolveSubpartParentIds(
  organizationId: string,
  subpartInstanceIds: string[]
): Promise<string[]> {
  if (subpartInstanceIds.length === 0) return []

  const rows = await database
    .select({ relatedEntityId: schema.FieldValue.relatedEntityId })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
    .where(
      and(
        inArray(schema.FieldValue.entityId, subpartInstanceIds),
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.CustomField.systemAttribute, 'subpart_parent_part')
      )
    )

  return [...new Set(rows.map((r) => r.relatedEntityId).filter((id): id is string => id != null))]
}
