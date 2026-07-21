// packages/lib/src/getting-started/mutations.ts
import type { Database, Transaction } from '@auxx/database'
import { onCacheEvent } from '../cache'
import { getOrganizationSetting, updateOrganizationSetting } from '../settings'
import {
  CHECKLISTS,
  type ChecklistId,
  DEFAULT_GETTING_STARTED_STATE,
  type GettingStartedState,
  type GoalKey,
  isGoalKey,
} from './client'
import type { GettingStartedContext } from './types'

/** Read a checklist's current persisted state directly (not via cache — write path). */
async function readState(
  db: Database | Transaction | undefined,
  organizationId: string,
  checklistId: ChecklistId
) {
  const value = await getOrganizationSetting({
    organizationId,
    key: CHECKLISTS[checklistId].settingKey,
    db,
  })
  return (value as GettingStartedState | null) ?? DEFAULT_GETTING_STARTED_STATE
}

/** Persist a checklist's new state + invalidate the org-settings cache. */
async function writeState(
  db: Database | Transaction | undefined,
  organizationId: string,
  checklistId: ChecklistId,
  state: GettingStartedState
) {
  await updateOrganizationSetting({
    organizationId,
    key: CHECKLISTS[checklistId].settingKey,
    value: state,
    db,
  })
  await onCacheEvent('org.settings.changed', { orgId: organizationId })
}

/**
 * Record a single goal as manually complete (e.g. the extension step). Unions
 * into `manualCompletions` — never clobbers, so concurrent writers are safe.
 */
export async function markGoalComplete(
  ctx: GettingStartedContext,
  checklistId: ChecklistId,
  key: GoalKey
): Promise<void> {
  const state = await readState(ctx.db, ctx.organizationId, checklistId)
  if (state.manualCompletions.includes(key)) return
  await writeState(ctx.db, ctx.organizationId, checklistId, {
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
  checklistId: ChecklistId,
  keys: readonly string[]
): Promise<void> {
  const state = await readState(ctx.db, ctx.organizationId, checklistId)
  const union = new Set(state.manualCompletions)
  for (const key of keys) {
    if (isGoalKey(checklistId, key)) union.add(key)
  }
  await writeState(ctx.db, ctx.organizationId, checklistId, {
    ...state,
    manualCompletions: [...union],
  })
}

/** Dismiss (stamp `dismissedAt`) or un-dismiss (clear it) the widget. */
export async function setDismissed(
  ctx: GettingStartedContext,
  checklistId: ChecklistId,
  dismissed: boolean
): Promise<void> {
  const state = await readState(ctx.db, ctx.organizationId, checklistId)
  await writeState(ctx.db, ctx.organizationId, checklistId, {
    ...state,
    dismissedAt: dismissed ? new Date().toISOString() : null,
  })
}

/**
 * Stamp `wizardCompletedAt` for a checklist's setup wizard (finished or
 * skipped — either way it should never auto-open again). Idempotent: a
 * checklist that's already stamped is left untouched.
 */
export async function setWizardCompleted(
  ctx: GettingStartedContext,
  checklistId: ChecklistId
): Promise<void> {
  const state = await readState(ctx.db, ctx.organizationId, checklistId)
  if (state.wizardCompletedAt) return
  await writeState(ctx.db, ctx.organizationId, checklistId, {
    ...state,
    wizardCompletedAt: new Date().toISOString(),
  })
}
