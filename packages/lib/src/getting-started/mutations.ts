// packages/lib/src/getting-started/mutations.ts
import type { Database, Transaction } from '@auxx/database'
import { onCacheEvent } from '../cache'
import { getOrganizationSetting, updateOrganizationSetting } from '../settings'
import {
  DEFAULT_GETTING_STARTED_STATE,
  GETTING_STARTED_SETTING_KEY,
  type GettingStartedState,
  type GoalKey,
  isGoalKey,
} from './client'
import type { GettingStartedContext } from './types'

/** Read the current persisted state directly (not via cache — write path). */
async function readState(db: Database | Transaction | undefined, organizationId: string) {
  const value = await getOrganizationSetting({
    organizationId,
    key: GETTING_STARTED_SETTING_KEY,
    db,
  })
  return (value as GettingStartedState | null) ?? DEFAULT_GETTING_STARTED_STATE
}

/** Persist new state + invalidate the org-settings cache. */
async function writeState(
  db: Database | Transaction | undefined,
  organizationId: string,
  state: GettingStartedState
) {
  await updateOrganizationSetting({
    organizationId,
    key: GETTING_STARTED_SETTING_KEY,
    value: state,
    db,
  })
  await onCacheEvent('org.settings.changed', { orgId: organizationId })
}

/**
 * Record a single goal as manually complete (e.g. the extension step). Unions
 * into `manualCompletions` — never clobbers, so concurrent writers are safe.
 */
export async function markGoalComplete(ctx: GettingStartedContext, key: GoalKey): Promise<void> {
  const state = await readState(ctx.db, ctx.organizationId)
  if (state.manualCompletions.includes(key)) return
  await writeState(ctx.db, ctx.organizationId, {
    ...state,
    manualCompletions: [...state.manualCompletions, key],
  })
}

/**
 * Mark every currently-displayed goal complete ("Mark all"). Unions the passed
 * keys into `manualCompletions` so auto-inferred goals also stick.
 */
export async function completeAllGoals(
  ctx: GettingStartedContext,
  keys: readonly string[]
): Promise<void> {
  const state = await readState(ctx.db, ctx.organizationId)
  const union = new Set(state.manualCompletions)
  for (const key of keys) {
    if (isGoalKey(key)) union.add(key)
  }
  await writeState(ctx.db, ctx.organizationId, {
    ...state,
    manualCompletions: [...union],
  })
}

/** Dismiss (stamp `dismissedAt`) or un-dismiss (clear it) the widget. */
export async function setDismissed(ctx: GettingStartedContext, dismissed: boolean): Promise<void> {
  const state = await readState(ctx.db, ctx.organizationId)
  await writeState(ctx.db, ctx.organizationId, {
    ...state,
    dismissedAt: dismissed ? new Date().toISOString() : null,
  })
}
