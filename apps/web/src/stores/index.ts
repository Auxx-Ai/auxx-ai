// apps/web/src/stores/index.ts

export {
  createHydrationStore,
  createHydrationHooks,
  createHydrationStoreWithHooks,
  type HydrationStoreOptions,
  type HydrationStoreState,
  type HydrationStoreActions,
  type HydrationStore,
} from './create-hydration-store'

export {
  useWorkflowRunStatusStore,
  type TrackedRun,
  type BatchProgress,
  type ResourceType,
  type RunStatus,
} from './workflow-run-status-store'

// Custom field value store exports (commented - import directly from component path)
// export {
//   useFieldValueStore,
//   useFieldValue,
//   useResourceFieldValues,
//   buildFieldValueKey,
//   buildFieldValueKeyFromParts,
//   parseFieldValueKey,
//   toRecordId,
//   parseRecordId,
//   type FieldValueKey,
//   type RecordId,
// } from '../components/resources/store/custom-field-value-store'
