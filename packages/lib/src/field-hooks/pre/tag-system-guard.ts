// packages/lib/src/field-hooks/pre/tag-system-guard.ts

import { database, schema } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { ForbiddenError } from '../../errors'
import { parseRecordId } from '../../resources/resource-id'
import type { EntityPreDeleteHandler, FieldPreHookHandler } from '../types'

/**
 * Look up the `is_system_tag` boolean for a given tag record. One keyed
 * FieldValue+CustomField join. Returns `false` when no value row exists
 * (the field defaults to false on fresh records).
 */
async function readIsSystemTag(recordId: RecordId, organizationId: string): Promise<boolean> {
  const { entityInstanceId } = parseRecordId(recordId)
  const [row] = await database
    .select({ valueBoolean: schema.FieldValue.valueBoolean })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
    .where(
      and(
        eq(schema.FieldValue.entityId, entityInstanceId),
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.CustomField.systemAttribute, 'is_system_tag')
      )
    )
    .limit(1)
  return row?.valueBoolean === true
}

/**
 * Silently drop any user-supplied write to `is_system_tag`. Only the seeder
 * (which puts `is_system_tag` in `ctx.bypassFieldGuards`) is allowed to set
 * this flag — every other caller's value is discarded so the registry's
 * `capabilities.creatable: false` is actually enforced.
 *
 * The framework already short-circuits this hook when the bypass set
 * contains `is_system_tag`, so this body only runs for unauthorized writes.
 */
export const dropUnauthorizedSystemFlag: FieldPreHookHandler = async () => undefined

/**
 * Reject writes to a user-editable tag field (title, description, emoji,
 * color, parent) when the underlying record is a system tag. Throws a 403;
 * the tRPC surface returns it as FORBIDDEN.
 */
export const rejectIfSystemTag: FieldPreHookHandler = async (event) => {
  const isSystem = await readIsSystemTag(event.recordId, event.organizationId)
  if (isSystem) {
    throw new ForbiddenError('System tags cannot be modified')
  }
  return event.newValue
}

/**
 * Reject a delete when the target is a system tag. `event.values` is
 * pre-captured by the pre-delete fire point, so no extra read is needed.
 */
export const rejectDeleteIfSystemTag: EntityPreDeleteHandler = async (event) => {
  if (event.values.is_system_tag === true) {
    throw new ForbiddenError('System tags cannot be deleted')
  }
}
