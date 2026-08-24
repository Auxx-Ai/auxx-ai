// packages/lib/src/jobs/maintenance/index.ts

export { type AgentDraftCleanupStats, agentDraftCleanupJob } from './agent-draft-cleanup-job'
export { type AppStorageSweepStats, appStorageSweepJob } from './app-storage-sweep-job'
// Per-request provider deletion / deauthorize teardown (plan §4.4). On-demand,
// enqueued by the Meta signed_request routes and the Shopify compliance webhook.
export {
  DATA_DELETION_JOB_NAME,
  type DataDeletionJobData,
  dataDeletionJob,
  enqueueDataDeletionJob,
} from './data-deletion-job'
export { dataMigrationsJob, enqueueDataMigrationsRun } from './data-migrations-job'
export {
  type CleanupStats,
  expiredTrialAccountCleanupJob,
  type OrganizationToDelete,
} from './expired-trial-account-cleanup-job'
// The three scheduled file-lifecycle sweeps. They moved out of
// `files/lifecycle/` in plan 7c so that module no longer binds the pool at
// module scope; the reapers they call take a `Database` as a parameter.
export {
  deletedFileCleanupJob,
  type FileCleanupJobData,
  type FileCleanupJobResult,
  orphanedFileCleanupJob,
  storageQuotaCheckJob,
} from './file-cleanup-jobs'
export { generateThumbnailJob } from './generate-thumbnail-job'
export { type GettingStartedStats, sendGettingStartedEmailsJob } from './getting-started-job'
export {
  MAIL_SUGGESTIONS_JOB_NAME,
  type MailSuggestionsJobData,
  type MailSuggestionsJobStats,
  mailSuggestionsJob,
} from './mail-suggestions-job'
// Daily unsubscribe sweep — detects senders that ignored an unsubscribe request
// (`MailUnsubscribe.lastSeenAfterAt` / `messagesSeenAfter`, plan §6.4).
export { mailUnsubscribeSweepJob } from './mail-unsubscribe-sweep-job'
export { cleanupExpiredMediaAssetsJob, getMediaAssetCleanupStats } from './media-asset-cleanup-job'
export { type MidTrialStats, sendMidTrialEmailsJob } from './mid-trial-job'
export { oauth2TokenRefreshScannerJob } from './oauth2-token-refresh-scanner-job'
export {
  enqueueOrphanedStorageObjectCleanup,
  type OrphanedStorageObjectJobData,
  orphanedStorageObjectJob,
} from './orphaned-storage-object-job'
export { type QuotaResetStats, quotaResetJob } from './quota-reset-job'
export {
  type ReconcileRecordIdentitiesStats,
  reconcileRecordIdentitiesJob,
} from './reconcile-record-identities-job'
export {
  type StalePendingMessageSweeperStats,
  stalePendingMessageSweeperJob,
} from './stale-pending-message-sweeper-job'
export {
  enqueueStorageCleanupJob,
  type StorageCleanupJobData,
  storageCleanupJob,
} from './storage-cleanup-job'
export { getThumbnailCleanupStats, thumbnailCleanupJob } from './thumbnail-cleanup-job'
export { sendTrialConversionEmailsJob, type TrialConversionStats } from './trial-conversion-job'
export { type WebhookRenewalJobData, webhookRenewalJob } from './webhook-renewal-job'
export {
  type WebhookRenewalScannerJobData,
  webhookRenewalScannerJob,
} from './webhook-renewal-scanner-job'
