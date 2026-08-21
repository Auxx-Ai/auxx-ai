// packages/lib/src/import/planning/create-strategy.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { ImportStrategyMode } from '../types/mapping'
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

  if (!result) {
    throw new Error('Failed to create import plan strategy')
  }

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
 * Create the strategy rows a plan needs, given the RESOLVED identifier keys and
 * the mode.
 *
 * The set created here must cover every strategy `analyzeRow` can return for
 * the same inputs, or a row lands in a bucket that does not exist. That is why
 * this takes the resolved keys (post auto-select) rather than the raw option,
 * and why the caller creates strategies AFTER identifier resolution.
 *
 * - `create`, always.
 * - `update`, at least one identifier key AND the mode is not `create`.
 * - `skip`, always (a row error can happen in any mode).
 * - `unmatched`, `update` mode only; no other mode can produce one.
 *
 * @param db - Database instance
 * @param planId - Plan ID
 * @param identifierFieldKeys - Resolved match key, ordered. Empty ⇒ create-only.
 * @param mode - Job-level strategy mode
 * @returns Array of created strategies
 */
export async function createDefaultStrategies(
  db: Database,
  planId: string,
  identifierFieldKeys: string[] = [],
  mode: ImportStrategyMode = 'create-or-update'
): Promise<ImportPlanStrategy[]> {
  const strategies: ImportPlanStrategy[] = []

  // `matchingFieldKey` is a single `text()` column, so a COMPOSITE key is
  // recorded by its first component only. It is display/diagnostic metadata,
  // the planner reads `identifierFieldKeys`, never this column, so the
  // truncation costs nothing at runtime. Widening it would be a schema change.
  const matchingFieldKey = identifierFieldKeys[0]

  // Create strategy
  strategies.push(await createStrategy(db, { planId, strategy: 'create' }))

  // Update strategy (needs something to match on, and a mode that updates)
  if (identifierFieldKeys.length > 0 && mode !== 'create') {
    strategies.push(await createStrategy(db, { planId, strategy: 'update', matchingFieldKey }))
  }

  // Skip strategy (for rows with errors)
  strategies.push(await createStrategy(db, { planId, strategy: 'skip' }))

  // Unmatched strategy, update-only mode found no record. NOT an error, and
  // never the same badge as `skip`.
  if (mode === 'update') {
    strategies.push(await createStrategy(db, { planId, strategy: 'unmatched', matchingFieldKey }))
  }

  return strategies
}
