// packages/lib/src/import/planning/create-strategy.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { ImportPlanStrategy, StrategyType } from '../types/plan'

/** Input for creating a strategy */
export interface CreateStrategyInput {
  planId: string
  strategy: StrategyType
  matchingFieldKey?: string
  matchingCustomFieldId?: string
}

/**
 * Create a new import plan strategy.
 *
 * @param db - Database instance
 * @param input - Strategy input
 * @returns The created strategy
 */
export async function createStrategy(
  db: Database,
  input: CreateStrategyInput
): Promise<ImportPlanStrategy> {
  const [result] = await db
    .insert(schema.ImportPlanStrategy)
    .values({
      importPlanId: input.planId,
      strategy: input.strategy,
      matchingFieldKey: input.matchingFieldKey,
      matchingCustomFieldId: input.matchingCustomFieldId,
      status: 'planning_queued',
      updatedAt: new Date(),
    })
    .returning()

  return {
    id: result.id,
    importPlanId: result.importPlanId,
    strategy: result.strategy as StrategyType,
    matchingFieldKey: result.matchingFieldKey,
    matchingCustomFieldId: result.matchingCustomFieldId,
    status: result.status as ImportPlanStrategy['status'],
    planningProgress: result.planningProgress as ImportPlanStrategy['planningProgress'],
    statistics: result.statistics as ImportPlanStrategy['statistics'],
  }
}

/**
 * Create default strategies for a plan.
 * Creates create, update, and skip strategies.
 *
 * @param db - Database instance
 * @param planId - Plan ID
 * @param identifierFieldKey - Field used for duplicate detection (for update strategy)
 * @returns Array of created strategies
 */
export async function createDefaultStrategies(
  db: Database,
  planId: string,
  identifierFieldKey?: string
): Promise<ImportPlanStrategy[]> {
  const strategies: ImportPlanStrategy[] = []

  // Create strategy
  strategies.push(await createStrategy(db, { planId, strategy: 'create' }))

  // Update strategy (if identifier field is provided)
  if (identifierFieldKey) {
    strategies.push(
      await createStrategy(db, {
        planId,
        strategy: 'update',
        matchingFieldKey: identifierFieldKey,
      })
    )
  }

  // Skip strategy (for rows with errors)
  strategies.push(await createStrategy(db, { planId, strategy: 'skip' }))

  return strategies
}
