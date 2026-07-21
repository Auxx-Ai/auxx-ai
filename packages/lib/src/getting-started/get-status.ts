// packages/lib/src/getting-started/get-status.ts
import { getOrgCache } from '../cache'
import {
  CHECKLISTS,
  type ChecklistId,
  DEFAULT_GETTING_STARTED_STATE,
  type GettingStartedState,
  type GettingStartedStatus,
  type GoalKey,
  isGoalKey,
} from './client'
import { getAutoInferredGoals } from './signals'
import type { GettingStartedContext } from './types'

/** Read a checklist's persisted state from the `orgSettings` cache (defaults merged in). */
export async function getGettingStartedState(
  ctx: GettingStartedContext,
  checklistId: ChecklistId
): Promise<GettingStartedState> {
  const settings = await getOrgCache().get(ctx.organizationId, 'orgSettings')
  const settingKey = CHECKLISTS[checklistId].settingKey
  return (settings[settingKey] as GettingStartedState | undefined) ?? DEFAULT_GETTING_STARTED_STATE
}

/**
 * Resolve the full checklist status for an org: the union of auto-inferred
 * goals and explicitly-recorded manual completions, plus the dismissal flag
 * and wizard-completion timestamp. Every read is cache-backed (one DB hit per
 * DB-touching signal).
 */
export async function getGettingStartedStatus(
  ctx: GettingStartedContext,
  checklistId: ChecklistId
): Promise<GettingStartedStatus> {
  const [state, autoGoals] = await Promise.all([
    getGettingStartedState(ctx, checklistId),
    getAutoInferredGoals(ctx, checklistId),
  ])

  const completed = new Set<GoalKey>(autoGoals)
  for (const key of state.manualCompletions) {
    if (isGoalKey(checklistId, key)) completed.add(key)
  }

  return {
    completedGoals: [...completed],
    dismissed: state.dismissedAt !== null,
    wizardCompletedAt: state.wizardCompletedAt ?? null,
  }
}
