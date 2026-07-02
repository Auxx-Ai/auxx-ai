// packages/lib/src/record-rules/index.ts

export { executeRuleAction } from './actions'
export { fireRecordRules } from './engine'
export { handleRecordRulesOnFieldChange } from './hook-handler'
export { resolveFieldRefToId } from './resolve-field-ref'
export { buildFieldKeyMap, makeSnapshotResolver, type RecordSnapshot } from './resolver'
export {
  createRecordRule,
  dehydrateRecordRule,
  deleteRecordRule,
  insertRecordRuleRun,
  listRecordRuleRuns,
  listRecordRules,
  type RecordRuleInput,
  type RecordRuleRunInput,
  updateRecordRule,
} from './store'
export { matchesFieldTransition } from './transitions'
export {
  type CachedRecordRule,
  FIELD_TRANSITIONS,
  LIFECYCLE_TRANSITIONS,
  type RecordRuleAction,
  type RecordRuleActionOutcome,
  type RecordRuleFireContext,
  type RecordRuleOn,
} from './types'
