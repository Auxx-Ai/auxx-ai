// packages/lib/src/resources/system-records/value-join.ts

import { schema } from '@auxx/database'
import { and, eq, type SQL } from 'drizzle-orm'
import type { alias } from 'drizzle-orm/pg-core'

/** The `FieldValue` alias join on `(entityId, organizationId, fieldId)`, for the reads that filter or sort on a value in SQL. */
export function systemValueJoin(
  table: ReturnType<typeof alias<typeof schema.FieldValue, string>>,
  fieldId: string
): SQL | undefined {
  return and(
    eq(table.entityId, schema.EntityInstance.id),
    eq(table.organizationId, schema.EntityInstance.organizationId),
    eq(table.fieldId, fieldId)
  )
}
