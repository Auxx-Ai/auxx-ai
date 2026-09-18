// packages/lib/src/accounting/mirror/index.ts
//
// Server entry point for the INBOUND half of the accounting seam (brief 20
// §5-§7): read the connected provider's general ledger, drop everything auxx
// authored, check those against our own copies, and write the remainder as our
// own rows.
//
// Client code must import `@auxx/lib/accounting/mirror/client`, never this barrel: the
// reads and writes pull `@auxx/database` and the poster behind it.

export {
  describeProviderSyncCoverage,
  isOurs,
  OUR_PROVIDER_TXN_TYPE,
  type OurEntryCheck,
  type OurEntryVerdict,
  type OurPostedEntry,
  type OurPostedLine,
  PROVIDER_SYNC_POSTING_TYPE,
  PROVIDER_SYNC_SCHEDULE_SETTING_KEY,
  PROVIDER_SYNC_SOURCE_TYPE,
  PROVIDER_SYNC_STATE_SETTING_KEY,
  PROVIDER_SYNCED_THROUGH_SETTING_KEY,
  type ProviderLedger,
  type ProviderLedgerBatch,
  type ProviderLedgerEntry,
  type ProviderLedgerLine,
  type ProviderLedgerSlicer,
  type ProviderSyncCoverage,
  type ProviderSyncMarker,
  type ProviderSyncPlan,
  type ProviderSyncRange,
  type ProviderSyncReading,
  type ProviderSyncRunRecord,
  type ProviderSyncRunStatus,
  type ProviderSyncScheduleConfig,
  type ProviderSyncStateBlob,
  providerDisplayName,
} from './client'
export { readProviderSyncMarker } from './marker-reads'
export { recordProviderSyncedThrough } from './marker-writes'
export {
  groupProviderLedgerEntries,
  invertAccountMap,
  type PlanProviderSyncInput,
  planProviderSync,
  resolveProviderSyncLines,
} from './plan'
export {
  enqueueProviderSync,
  enqueueProviderSyncSlice,
  PROVIDER_SYNC_JOB_NAME,
  PROVIDER_SYNC_RUN_STALE_MS,
  PROVIDER_SYNC_SCHEDULED_JOB_NAME,
  type ProviderSyncJobData,
  type ProviderSyncTrigger,
} from './queue'
export {
  firstDayAfterMonth,
  monthChunk,
  nextDay,
  type PlanSyncChunksInput,
  planSyncChunks,
  providerSyncFloor,
} from './range'
export {
  type MirrorEntry,
  type ReadOurPostedEntriesInput,
  readActiveBookId,
  readMirrorForTranslation,
  readOurDocNumbers,
  readOurPostedEntries,
  readOurProviderEntryIds,
} from './reads'
export {
  applySyncStateToBlob,
  blockMarkerForRun,
  closeRunInBlob,
  createProviderSyncRunLedger,
  createProviderSyncStateStore,
  isMarkerBlockedForRun,
  readProviderSyncRunState,
  recordSliceInBlob,
  syncStateFromBlob,
} from './run-state'
export {
  reconcileProviderSyncSchedulers,
  removeProviderSyncScheduler,
  syncProviderSyncScheduler,
} from './scheduler'
export {
  type DeferredEntry,
  type ProviderSyncChunkOutcome,
  type ProviderSyncOutcome,
  type SyncProviderLedgerInput,
  syncProviderLedger,
} from './sync'
export { type ChunkContext, syncOneChunk } from './sync-chunk'
export {
  type CreateProviderLedgerSyncSourceInput,
  createProviderLedgerSyncSource,
  type ProviderLedgerSyncProgress,
  type ProviderLedgerSyncSource,
} from './sync-source'
export {
  type TranslateMirrorInput,
  type TranslateMirrorOutcome,
  translateMirrorRange,
} from './translate'
export {
  type MirrorChunkOutcome,
  type OurLedgerIdentity,
  type UpsertMirrorChunkInput,
  upsertMirrorChunk,
} from './writes'
