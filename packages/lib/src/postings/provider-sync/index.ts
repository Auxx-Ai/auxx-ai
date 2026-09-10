// packages/lib/src/postings/provider-sync/index.ts
//
// Server entry point for the INBOUND half of the accounting seam (brief 20
// §5-§7): read the connected provider's general ledger, drop everything auxx
// authored, check those against our own copies, and write the remainder as our
// own rows.
//
// Client code must import `@auxx/lib/postings/client`, never this barrel: the
// reads and writes pull `@auxx/database` and the poster behind it.

export {
  isOurs,
  OUR_PROVIDER_TXN_TYPE,
  type OurEntryCheck,
  type OurEntryVerdict,
  type OurPostedEntry,
  type OurPostedLine,
  PROVIDER_SYNC_POSTING_TYPE,
  PROVIDER_SYNC_SOURCE_TYPE,
  type ProviderLedger,
  type ProviderLedgerEntry,
  type ProviderLedgerLine,
  type ProviderSyncPlan,
  type ProviderSyncRange,
} from './client'
export {
  groupProviderLedgerEntries,
  invertAccountMap,
  type PlanProviderSyncInput,
  planProviderSync,
  resolveProviderSyncLines,
} from './plan'
export { type PlanSyncChunksInput, planSyncChunks, providerSyncFloor } from './range'
export {
  type ReadOurPostedEntriesInput,
  readOurPostedEntries,
  readOurProviderEntryIds,
  readSyncedEntriesInRange,
  type SyncedEntryRef,
} from './reads'
export {
  type DeferredEntry,
  type ProviderSyncChunkOutcome,
  type ProviderSyncOutcome,
  type SyncProviderLedgerInput,
  syncProviderLedger,
} from './sync'
export {
  type PostProviderSyncEntryInput,
  type ProviderSyncEntryOutcome,
  postProviderSyncEntry,
  reverseSyncedEntry,
} from './writes'
