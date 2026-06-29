// packages/lib/src/getting-started/getting-started-service.ts

import type { GoalKey } from './client'
import { getGettingStartedState, getGettingStartedStatus } from './get-status'
import { completeAllGoals, markGoalComplete, setDismissed } from './mutations'
import type { GettingStartedContext } from './types'

/**
 * Thin object wrapper over the functional getting-started API, holding a fixed
 * {@link GettingStartedContext}. Parity with `KBService` — callers that prefer
 * the object form use this; new code can call the functions directly.
 */
export class GettingStartedService {
  constructor(private readonly ctx: GettingStartedContext) {}

  getStatus() {
    return getGettingStartedStatus(this.ctx)
  }

  getState() {
    return getGettingStartedState(this.ctx)
  }

  markGoalComplete(key: GoalKey) {
    return markGoalComplete(this.ctx, key)
  }

  completeAllGoals(keys: readonly string[]) {
    return completeAllGoals(this.ctx, keys)
  }

  setDismissed(dismissed: boolean) {
    return setDismissed(this.ctx, dismissed)
  }
}
