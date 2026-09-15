// packages/lib/src/postings/accounting-commit-lock.ts
import type { Transaction } from '@auxx/database'
import { sql } from 'drizzle-orm'

/** Serialize financial commands until the caller's transaction commits or rolls back. */
export async function withAccountingCommitLock(
  tx: Transaction,
  organizationId: string
): Promise<void> {
  if (!organizationId) throw new Error('An organization is required for accounting commands')
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${'auxx:accounting:' + organizationId}, 0))`
  )
}
