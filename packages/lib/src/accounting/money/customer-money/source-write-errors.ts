// packages/lib/src/accounting/money/customer-money/source-write-errors.ts
import { type Database, schema } from '@auxx/database'
import { ConflictError } from '../../../errors'

/** A concurrent writer already committed the canonical record for this source identity. */
export class FinancialSourceIdentityConflictError extends ConflictError {
  constructor(readonly canonicalRecordId: string) {
    super('Source identity already belongs to another canonical financial record')
  }
}

/** Rolls back ordinary field writes while retaining the older observation for audit. */
export class StaleFinancialSourceRevisionError extends ConflictError {
  constructor(readonly observation: typeof schema.FinancialSourceObservation.$inferInsert) {
    super('Financial source revision is older than the stored observation')
  }
}

/** Save an ignored observation only after the attempted field transaction has rolled back. */
export async function recordStaleFinancialObservation(
  db: Database,
  organizationId: string,
  error: StaleFinancialSourceRevisionError
): Promise<void> {
  if (error.observation.organizationId !== organizationId) {
    throw new ConflictError('Financial observation belongs to another organization')
  }
  await db.insert(schema.FinancialSourceObservation).values(error.observation).onConflictDoNothing()
}
