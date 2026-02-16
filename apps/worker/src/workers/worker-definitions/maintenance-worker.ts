// import * as jobs from '@auxx/lib/jobs/definitions'

import { isSelfHosted } from '@auxx/deployment'
import {
  deletedFileCleanupJob,
  orphanedFileCleanupJob,
  storageQuotaCheckJob,
} from '@auxx/lib/files'
import type { JobHandler } from '@auxx/lib/jobs'
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
  expiredTrialAccountCleanup: cloudOnly(expiredTrialAccountCleanupJob),

  // Lifecycle email jobs (cloud-only)
  sendGettingStartedEmailsJob: cloudOnly(sendGettingStartedEmailsJob),
  sendMidTrialEmailsJob: cloudOnly(sendMidTrialEmailsJob),
  sendTrialConversionEmailsJob: cloudOnly(sendTrialConversionEmailsJob),

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
