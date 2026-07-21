// packages/lib/src/getting-started/index.ts
// Server entrypoint for the getting-started checklist engine. Client-safe
// catalog/types live in ./client (import those from the web widget).

export {
  CHECKLIST_IDS,
  CHECKLISTS,
  type ChecklistId,
  DEFAULT_GETTING_STARTED_STATE,
  DISPATCH_GETTING_STARTED_SETTING_KEY,
  DISPATCH_GOAL_KEYS,
  type DispatchGoalKey,
  GETTING_STARTED_SETTING_KEY,
  type GettingStartedState,
  type GettingStartedStatus,
  type GoalKey,
  isGoalKey,
  MAIN_GOAL_KEYS,
  type MainGoalKey,
} from './client'
export { getGettingStartedState, getGettingStartedStatus } from './get-status'
export { GettingStartedService } from './getting-started-service'
export {
  completeAllGoals,
  markGoalComplete,
  setDismissed,
  setWizardCompleted,
} from './mutations'
export { getAutoInferredGoals } from './signals'
export type { GettingStartedContext } from './types'
