// packages/lib/src/getting-started/index.ts
// Server entrypoint for the getting-started checklist. Client-safe catalog/types
// live in ./client (import those from the web widget).

export {
  DEFAULT_GETTING_STARTED_STATE,
  GETTING_STARTED_SETTING_KEY,
  type GettingStartedState,
  type GettingStartedStatus,
  GOAL_KEYS,
  type GoalKey,
  isGoalKey,
  MANUAL_GOAL_KEYS,
} from './client'
export { getGettingStartedState, getGettingStartedStatus } from './get-status'
export { GettingStartedService } from './getting-started-service'
export { completeAllGoals, markGoalComplete, setDismissed } from './mutations'
export { getAutoInferredGoals } from './signals'
export type { GettingStartedContext } from './types'
