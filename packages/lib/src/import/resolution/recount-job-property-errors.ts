// packages/lib/src/import/resolution/recount-job-property-errors.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, count, eq, isNull } from 'drizzle-orm'

/**
 * Recount and store a column's `ImportJobProperty.errorCount`: values the resolver could not read
 * and the user has not overridden. An override (a fix or a skip) is never an error.
 *
 * @param db - Database instance
 * @param jobPropertyId - The column's `ImportJobProperty.id`
 * @returns The stored count
 */
export async function recountJobPropertyErrors(
  db: Database,
  jobPropertyId: string
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.ImportValueResolution)
    .where(
      and(
        eq(schema.ImportValueResolution.importJobPropertyId, jobPropertyId),
        eq(schema.ImportValueResolution.isValid, false),
        isNull(schema.ImportValueResolution.userOverride)
      )
    )
  const errorCount = Number(row?.n ?? 0)

  await db
    .update(schema.ImportJobProperty)
    .set({ errorCount, updatedAt: new Date() })
    .where(eq(schema.ImportJobProperty.id, jobPropertyId))

  return errorCount
}
