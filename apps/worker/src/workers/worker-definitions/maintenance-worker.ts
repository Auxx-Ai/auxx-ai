import { isSelfHosted } from '@auxx/deployment'
import {
  deletedFileCleanupJob,
  orphanedFileCleanupJob,
  storageQuotaCheckJob,
} from '@auxx/lib/files'
import {
  applyScheduledSubscriptionChangesJob,
  channelTokenRefreshJob,
  channelTokenRefreshScannerJob,
  cleanupExpiredMediaAssetsJob,
  demoCleanupJob,
  demoSeedJob,
  expiredTrialAccountCleanupJob,
  type JobHandler,
  oauth2TokenRefreshScannerJob,
  orphanedAppBundleCleanupJob,
  quotaResetJob,
  sendGettingStartedEmailsJob,
  sendMidTrialEmailsJob,
  sendTrialConversionEmailsJob,
  storageCleanupJob,
  stripeSubscriptionSyncJob,
  thumbnailCleanupJob,
} from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('maintenance-worker')

/** Wraps a job handler to skip execution in self-hosted mode (defense in depth) */
function cloudOnly(handler: JobHandler): JobHandler {
  return async (ctx) => {
    if (isSelfHosted()) {
      logger.info(`Skipping ${ctx.jobName} in self-hosted mode`)
      return
    }
    return handler(ctx)
  }
}

const jobMappings = {
  // File cleanup jobs
  orphanedFileCleanupJob,
  deletedFileCleanupJob,
  storageQuotaCheckJob,

  // MediaAsset cleanup jobs
  cleanupExpiredMediaAssetsJob,
  thumbnailCleanupJob,
  thumbnailVersionCleanupJob: thumbnailCleanupJob, // Same handler, different schedule

  // Billing jobs (cloud-only)
  applyScheduledSubscriptionChangesJob: cloudOnly(applyScheduledSubscriptionChangesJob),
  stripeSubscriptionSyncJob: cloudOnly(stripeSubscriptionSyncJob),

  // Account management jobs (cloud-only)
  demoCleanupJob: cloudOnly(demoCleanupJob),
  demoSeedJob: cloudOnly(demoSeedJob),
  expiredTrialAccountCleanup: cloudOnly(expiredTrialAccountCleanupJob),

  // Lifecycle email jobs (cloud-only)
  sendGettingStartedEmailsJob: cloudOnly(sendGettingStartedEmailsJob),
  sendMidTrialEmailsJob: cloudOnly(sendMidTrialEmailsJob),
  sendTrialConversionEmailsJob: cloudOnly(sendTrialConversionEmailsJob),

  // OAuth2 token refresh scanner
  oauth2TokenRefreshScannerJob,

  // Integration OAuth2 token refresh (for Integration table)
  integrationTokenRefreshScannerJob: channelTokenRefreshScannerJob,
  integrationTokenRefreshJob: channelTokenRefreshJob,

  // App bundle cleanup
  orphanedAppBundleCleanupJob,

  // Quota management jobs
  quotaResetJob,

  // Storage cleanup (on-demand, enqueued by disconnect/delete flows)
  storageCleanupJob,
}

export function startMaintenanceWorker() {
  return createWorker(Queues.maintenanceQueue, jobMappings)
}
