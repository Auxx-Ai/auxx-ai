// packages/lib/src/sync-core/index.ts
// Shared sync core — channel-agnostic, sink-agnostic orchestration both
// `runDataConnectorSync` and (later) the channel `MessageSyncService` call into.
// Data-connectors is the first consumer; channels adopt after their migration.
// See plans/data-connectors/v3/shared-sync-core-plan.md.

export type {
  RunLedger,
  SliceBudget,
  SliceCommit,
  SliceResult,
  SyncCursor,
  SyncPhase,
  SyncRunCounters,
  SyncSliceCtx,
  SyncSource,
  SyncState,
  SyncStateStore,
  ThrottleHandle,
} from './contracts'
export { type RunSliceArgs, runSyncSlice, type SliceOutcome } from './slice-runner'
export { createThrottleHandle } from './throttle'
