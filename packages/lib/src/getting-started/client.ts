// packages/lib/src/getting-started/client.ts
// CLIENT-SAFE: goal-key catalog shared by the server signal layer and the web
// widget. No server-only deps — display metadata (labels, icons, CTA routes)
// lives in the web component, this only owns the canonical key set.

/** The setting key under which the org-wide getting-started state is persisted. */
export const GETTING_STARTED_SETTING_KEY = 'onboarding.gettingStarted' as const

/** The setting key under which the dispatch getting-started state is persisted. */
export const DISPATCH_GETTING_STARTED_SETTING_KEY = 'onboarding.dispatchGettingStarted' as const

/** The setting key under which the accounting getting-started state is persisted. */
export const ACCOUNTING_GETTING_STARTED_SETTING_KEY = 'onboarding.accountingGettingStarted' as const

/**
 * The known onboarding checklists. `main` is the org-wide checklist; `dispatch`
 * and `accounting` are the module ones.
 */
export const CHECKLIST_IDS = ['main', 'dispatch', 'accounting'] as const

export type ChecklistId = (typeof CHECKLIST_IDS)[number]

/** Canonical, ordered list of org-wide onboarding goal keys. Order is display order. */
export const MAIN_GOAL_KEYS = [
  'connect-email',
  'setup-agent',
  'create-workflow',
  'create-field',
  'invite-team',
  'install-extension',
] as const

/** Canonical, ordered list of dispatch onboarding goal keys. Order is display order. */
export const DISPATCH_GOAL_KEYS = [
  'add-workers',
  'set-address',
  'set-hours',
  'add-product',
  'set-tax-rate',
  'create-request',
  'create-work-order',
  'schedule-visit',
] as const

/**
 * Canonical, ordered list of accounting onboarding goal keys. Order is display order.
 *
 * Deliberately COARSE - one goal per wizard page, not one per settings field.
 * Cutoff and book timezone are two inputs on one page that take five seconds
 * together, and `dispatch` does not split `set-address` into street and city
 * either (plans/money/tasks/13-accounting-ui.md section 3.2).
 *
 * 🛑 There is no `connect-quickbooks` goal, and that is a decision rather than an
 * omission. Decision `P1` makes "nothing connected" a FIRST-CLASS case: the entry
 * is built, balanced and persisted identically and the poster reports
 * `not_connected`. A checklist that nagged for a provider would contradict the
 * design the whole poster rests on.
 */
export const ACCOUNTING_GOAL_KEYS = [
  'set-accounting-period',
  'set-opening-balances',
  'set-costing',
  'map-accounts',
  'finalize-setup',
  'post-first-entry',
] as const

export type MainGoalKey = (typeof MAIN_GOAL_KEYS)[number]
export type DispatchGoalKey = (typeof DISPATCH_GOAL_KEYS)[number]
export type AccountingGoalKey = (typeof ACCOUNTING_GOAL_KEYS)[number]
export type GoalKey = MainGoalKey | DispatchGoalKey | AccountingGoalKey

/** Per-checklist registry: setting key, goal-key set, and manual-only goals. */
export const CHECKLISTS: Record<
  ChecklistId,
  {
    settingKey:
      | typeof GETTING_STARTED_SETTING_KEY
      | typeof DISPATCH_GETTING_STARTED_SETTING_KEY
      | typeof ACCOUNTING_GETTING_STARTED_SETTING_KEY
    goalKeys: readonly GoalKey[]
    /** Goals with no server signal — completed only via manualCompletions. */
    manualGoalKeys: readonly GoalKey[]
  }
> = {
  main: {
    settingKey: GETTING_STARTED_SETTING_KEY,
    goalKeys: MAIN_GOAL_KEYS,
    manualGoalKeys: ['install-extension'],
  },
  dispatch: {
    settingKey: DISPATCH_GETTING_STARTED_SETTING_KEY,
    goalKeys: DISPATCH_GOAL_KEYS,
    manualGoalKeys: [],
  },
  accounting: {
    settingKey: ACCOUNTING_GETTING_STARTED_SETTING_KEY,
    goalKeys: ACCOUNTING_GOAL_KEYS,
    manualGoalKeys: [],
  },
}

/** Persisted per-org getting-started state (jsonb value of the setting). */
export type GettingStartedState = {
  /** ISO timestamp the widget was dismissed via the ⋯ menu; `null` = visible. */
  dismissedAt: string | null
  /** Goal keys completed explicitly (extension step, "mark all"). */
  manualCompletions: string[]
  /** Dispatch wizard: stamped when finished OR skipped — either way, never auto-open again. */
  wizardCompletedAt?: string | null
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
  /** ISO timestamp the setup wizard was finished/skipped; `null` = never run. */
  wizardCompletedAt: string | null
}

/** Narrow an arbitrary string to a goal key valid for the given checklist. */
export function isGoalKey(checklistId: ChecklistId, value: string): value is GoalKey {
  return (CHECKLISTS[checklistId].goalKeys as readonly string[]).includes(value)
}
