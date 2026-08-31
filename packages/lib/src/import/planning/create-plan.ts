// packages/lib/src/import/planning/create-plan.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { ImportPlan } from '../types/plan'

/**
 * Create the import plan record for a job, replacing any plan already on it.
 *
 * A job has exactly ONE plan. Re-planning is legitimate — the user goes back,
 * changes a mapping and comes forward again — but the old plan must go with it,
 * because nothing downstream can tell a superseded plan from the current one:
 * every reader picks the newest by `createdAt` and the rest linger as dead
 * strategies and rows. Accumulating them is how one 311-row BOM file ended up
 * with four plans and 1244 plan rows.
 *
 * The cascade on `ImportPlan` takes the strategies and their rows.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @returns The created plan
 */
export async function createPlan(db: Database, jobId: string): Promise<ImportPlan> {
  await db.delete(schema.ImportPlan).where(eq(schema.ImportPlan.importJobId, jobId))

  const [result] = await db
    .insert(schema.ImportPlan)
    .values({
      importJobId: jobId,
      status: 'planning',
      updatedAt: new Date(),
    })
    .returning()

  if (!result) {
    throw new Error('Failed to create import plan')
  }

  return {
    id: result.id,
    importJobId: result.importJobId,
    status: result.status as ImportPlan['status'],
    completedAt: result.completedAt ?? undefined,
    createdAt: result.createdAt,
  }
}
