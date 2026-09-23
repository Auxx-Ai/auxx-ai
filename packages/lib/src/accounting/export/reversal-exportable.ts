// packages/lib/src/accounting/export/reversal-exportable.ts

import { schema } from '@auxx/database'
import { type SQL, sql } from 'drizzle-orm'

/**
 * A posting may leave unless it reverses an entry no live batch holds: both halves go, or neither.
 * `posting` names the `GlPosting` row in the outer query - the table itself, or a raw alias.
 */
export function reversalMayExport(posting: SQL = sql`${schema.GlPosting}`): SQL {
  return sql`(${posting}."reversesId" IS NULL OR EXISTS (
    SELECT 1 FROM ${schema.ExportBatchPosting} original_member
    WHERE original_member."organizationId" = ${posting}."organizationId"
      AND original_member."glPostingId" = ${posting}."reversesId"
      AND original_member."withdrawnAt" IS NULL))`
}
