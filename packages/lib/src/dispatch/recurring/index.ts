// packages/lib/src/dispatch/recurring/index.ts
//
// Public surface of the dispatch recurring engine (M2c, plans/dispatch/06-recurring-engine.md).

export type { CancelVisitFollowingInput, EngagementActionInput } from './engagement-actions'
export {
  cancelVisitFollowing,
  endEngagement,
  pauseEngagement,
  resumeEngagement,
} from './engagement-actions'
export { getWorkOrderStatus, materializeVisits, sweepRecurringVisits } from './materialize'
export type { RecurrenceTemplate, SetRecurrenceRuleInput } from './rule-mutations'
export { setRecurrenceRule } from './rule-mutations'
