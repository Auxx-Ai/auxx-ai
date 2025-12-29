// packages/services/src/workflow-share/increment-end-user-run-count.ts

import { database, schema } from '@auxx/database'
import { eq, sql } from 'drizzle-orm'
import { ok, err, type Result } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { WorkflowShareError } from './errors'

/**
 * Options for incrementing run count
 */
export interface IncrementEndUserRunCountOptions {
  endUserId: string
}

/**
 * Increment run count for end user
 * Updates totalRuns and lastRunAt
 *
 * @param options - Options with end user ID
 * @returns Result indicating success or error
 */
export async function incrementEndUserRunCount(
  options: IncrementEndUserRunCountOptions
): Promise<Result<void, WorkflowShareError>> {
  const { endUserId } = options

  const dbResult = await fromDatabase(
    database
      .update(schema.EndUser)
      .set({
        totalRuns: sql`${schema.EndUser.totalRuns} + 1`,
        lastRunAt: new Date(),
      })
      .where(eq(schema.EndUser.id, endUserId)),
    'increment-end-user-run-count'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  return ok(undefined)
}
