// packages/lib/src/import/planning/update-plan-status.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'

/**
 * Mark a plan as completed (status='planned').
 * Called after strategy assignment is finished.
 *
 * @param db - Database instance
 * @param planId - Import plan ID
 */
export async function markPlanCompleted(db: Database, planId: string): Promise<void> {
  await db
    .update(schema.ImportPlan)
    .set({
      status: 'planned',
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.ImportPlan.id, planId))
}
