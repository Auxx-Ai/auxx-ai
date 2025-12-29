// packages/lib/src/import/planning/create-plan.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { ImportPlan } from '../types/plan'

/**
 * Create a new import plan record.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @returns The created plan
 */
export async function createPlan(db: Database, jobId: string): Promise<ImportPlan> {
  const [result] = await db
    .insert(schema.ImportPlan)
    .values({
      importJobId: jobId,
      status: 'planning',
      updatedAt: new Date(),
    })
    .returning()

  return {
    id: result.id,
    importJobId: result.importJobId,
    status: result.status as ImportPlan['status'],
    completedAt: result.completedAt ?? undefined,
    createdAt: result.createdAt,
  }
}
