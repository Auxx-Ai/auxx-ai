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
export {
  getWorkOrderStatus,
  materializeVisits,
  maybeEndExhaustedEngagement,
  sweepRecurringVisits,
} from './materialize'
export type {
  RecurrenceTemplate,
  SetRecurrenceRuleInput,
  SetSeriesEndInput,
} from './rule-mutations'
export { setRecurrenceRule, setSeriesEnd } from './rule-mutations'
