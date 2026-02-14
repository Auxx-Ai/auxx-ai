// import * as jobs from '@auxx/lib/jobs/definitions'

import {
  deletedFileCleanupJob,
  orphanedFileCleanupJob,
  storageQuotaCheckJob,
} from '@auxx/lib/files'
import {
  applyScheduledSubscriptionChangesJob,
  cleanupExpiredMediaAssetsJob,
  expiredTrialAccountCleanupJob,
  integrationTokenRefreshJob,
  integrationTokenRefreshScannerJob,
  oauth2TokenRefreshScannerJob,
  quotaResetJob,
  sendGettingStartedEmailsJob,
  sendMidTrialEmailsJob,
  sendTrialConversionEmailsJob,
  stripeSubscriptionSyncJob,
  thumbnailCleanupJob,
} from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/queues/types'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  // File cleanup jobs
  orphanedFileCleanupJob,
  deletedFileCleanupJob,
  storageQuotaCheckJob,

  // MediaAsset cleanup jobs
  cleanupExpiredMediaAssetsJob,
  thumbnailCleanupJob,
  thumbnailVersionCleanupJob: thumbnailCleanupJob, // Same handler, different schedule

  // Billing jobs
  applyScheduledSubscriptionChangesJob,
  stripeSubscriptionSyncJob,

  // Account management jobs
  expiredTrialAccountCleanup: expiredTrialAccountCleanupJob,

  // Lifecycle email jobs
  sendGettingStartedEmailsJob,
  sendMidTrialEmailsJob,
  sendTrialConversionEmailsJob,

  // OAuth2 token refresh scanner
  oauth2TokenRefreshScannerJob,

  // Integration OAuth2 token refresh (for Integration table)
  integrationTokenRefreshScannerJob,
  integrationTokenRefreshJob,

  // Quota management jobs
  quotaResetJob,
}

export function startMaintenanceWorker() {
  return createWorker(Queues.maintenanceQueue, jobMappings)
}
