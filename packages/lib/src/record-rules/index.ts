// packages/lib/src/record-rules/index.ts

export {
  executeRuleAction,
  getNativeRuleHandler,
  type NativeRuleHandler,
  type NativeRuleHandlerEvent,
  registerNativeRuleHandler,
} from './actions'
export {
  captureCreateFieldChanges,
  captureUpdateFieldChanges,
} from './capture-field-changes'
export { fireRecordRules, fireRecordRulesBatch } from './engine'
export { handleRecordRulesOnFieldChange } from './hook-handler'
export { resolveFieldRefToId } from './resolve-field-ref'
export { buildFieldKeyMap, makeSnapshotResolver, type RecordSnapshot } from './resolver'
export {
  RECORD_RULE_RUN_RETENTION_JOB_NAME,
  recordRuleRunRetentionJob,
} from './run-retention-job'
export { fetchResourceSnapshots } from './snapshot-fetcher'
export {
  assertRuleShape,
  createManagedRecordRule,
  createRecordRule,
  dehydrateRecordRule,
  deleteManagedRecordRulesForDef,
  deleteRecordRule,
  findManagedRecordRule,
  getRecordRuleById,
  insertRecordRuleRun,
  listRecordRuleRuns,
  listRecordRules,
  type ManagedRecordRuleInput,
  type RecordRuleInput,
  type RecordRuleRunInput,
  updateRecordRule,
} from './store'
export {
  type DefSubscriptions,
  getSyncRuleSubscriptions,
  type SyncRuleSubscriptions,
  subscriptionsEmpty,
} from './subscriptions'
export {
  createManifestCollector,
  loadManifestCollector,
  type ManifestCollector,
} from './sync-manifest-collector'
export type {
  ManifestFieldChange,
  SyncChangeManifest,
  SyncRecordsChangedEvent,
} from './sync-manifest-types'
export {
  declareSystemRules,
  getSystemRuleDeclarations,
  resolveSystemRules,
  type SystemRuleDeclaration,
  type SystemRuleLookup,
} from './system-rules'
export { matchesFieldTransition } from './transitions'
export {
  type CachedRecordRule,
  FIELD_TRANSITIONS,
  LIFECYCLE_TRANSITIONS,
  type NativeAction,
  type RecordRuleAction,
  type RecordRuleActionOutcome,
  type RecordRuleBatchContext,
  type RecordRuleBatchEvent,
  type RecordRuleFireContext,
  type RecordRuleOn,
} from './types'
