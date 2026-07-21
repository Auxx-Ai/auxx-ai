// packages/lib/src/getting-started/getting-started-service.ts

import type { ChecklistId, GoalKey } from './client'
import { getGettingStartedState, getGettingStartedStatus } from './get-status'
import { completeAllGoals, markGoalComplete, setDismissed, setWizardCompleted } from './mutations'
import type { GettingStartedContext } from './types'

/**
 * Thin object wrapper over the functional getting-started API, holding a fixed
 * {@link GettingStartedContext} and {@link ChecklistId}. Parity with `KBService`
 * — callers that prefer the object form use this; new code can call the
 * functions directly.
 */
export class GettingStartedService {
  constructor(
    private readonly ctx: GettingStartedContext,
    private readonly checklistId: ChecklistId = 'main'
  ) {}

  getStatus() {
    return getGettingStartedStatus(this.ctx, this.checklistId)
  }

  getState() {
    return getGettingStartedState(this.ctx, this.checklistId)
  }

  markGoalComplete(key: GoalKey) {
    return markGoalComplete(this.ctx, this.checklistId, key)
  }

  completeAllGoals(keys: readonly string[]) {
    return completeAllGoals(this.ctx, this.checklistId, keys)
  }

  setDismissed(dismissed: boolean) {
    return setDismissed(this.ctx, this.checklistId, dismissed)
  }

  setWizardCompleted() {
    return setWizardCompleted(this.ctx, this.checklistId)
  }
}
