// packages/lib/src/getting-started/client.ts
// CLIENT-SAFE: goal-key catalog shared by the server signal layer and the web
// widget. No server-only deps — display metadata (labels, icons, CTA routes)
// lives in the web component, this only owns the canonical key set.

/** The setting key under which getting-started state is persisted (per-org). */
export const GETTING_STARTED_SETTING_KEY = 'onboarding.gettingStarted'

/** Canonical, ordered list of onboarding goal keys. Order is display order. */
export const GOAL_KEYS = [
  'connect-email',
  'setup-agent',
  'create-workflow',
  'create-field',
  'invite-team',
  'install-extension',
] as const

export type GoalKey = (typeof GOAL_KEYS)[number]

/**
 * Goals with no server-derivable signal — completion is only ever recorded
 * explicitly in `manualCompletions` (see §6 of the plan). Everything else is
 * auto-inferred from live org state.
 */
export const MANUAL_GOAL_KEYS: readonly GoalKey[] = ['install-extension']

/** Persisted per-org getting-started state (jsonb value of the setting). */
export type GettingStartedState = {
  /** ISO timestamp the widget was dismissed via the ⋯ menu; `null` = visible. */
  dismissedAt: string | null
  /** Goal keys completed explicitly (extension step, "mark all"). */
  manualCompletions: string[]
}

/** Default state for an org that has never touched the checklist. */
export const DEFAULT_GETTING_STARTED_STATE: GettingStartedState = {
  dismissedAt: null,
  manualCompletions: [],
}

/** Status returned to the client: the resolved completed set + dismissal flag. */
export type GettingStartedStatus = {
  completedGoals: GoalKey[]
  dismissed: boolean
}

/** Narrow an arbitrary string to a known GoalKey. */
export function isGoalKey(value: string): value is GoalKey {
  return (GOAL_KEYS as readonly string[]).includes(value)
}
