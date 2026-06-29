// packages/lib/src/getting-started/get-status.ts
import { getOrgCache } from '../cache'
import {
  DEFAULT_GETTING_STARTED_STATE,
  GETTING_STARTED_SETTING_KEY,
  type GettingStartedState,
  type GettingStartedStatus,
  type GoalKey,
  isGoalKey,
} from './client'
import { getAutoInferredGoals } from './signals'
import type { GettingStartedContext } from './types'

/** Read persisted state from the `orgSettings` cache (defaults merged in). */
export async function getGettingStartedState(
  ctx: GettingStartedContext
): Promise<GettingStartedState> {
  const settings = await getOrgCache().get(ctx.organizationId, 'orgSettings')
  return (
    (settings[GETTING_STARTED_SETTING_KEY] as GettingStartedState | undefined) ??
    DEFAULT_GETTING_STARTED_STATE
  )
}

/**
 * Resolve the full checklist status for an org: the union of auto-inferred
 * goals and explicitly-recorded manual completions, plus the dismissal flag.
 * Every read is cache-backed (one DB hit for the pending-invite check).
 */
export async function getGettingStartedStatus(
  ctx: GettingStartedContext
): Promise<GettingStartedStatus> {
  const [state, autoGoals] = await Promise.all([
    getGettingStartedState(ctx),
    getAutoInferredGoals(ctx),
  ])

  const completed = new Set<GoalKey>(autoGoals)
  for (const key of state.manualCompletions) {
    if (isGoalKey(key)) completed.add(key)
  }

  return {
    completedGoals: [...completed],
    dismissed: state.dismissedAt !== null,
  }
}
