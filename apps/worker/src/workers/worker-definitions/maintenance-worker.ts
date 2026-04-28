import { isSelfHosted } from '@auxx/deployment'
import { isDemoEnabled } from '@auxx/lib/demo'
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
  type DemoSeedJobData,
  demoCleanupJob,
  expiredTrialAccountCleanupJob,
  type JobHandler,
  type OrgSeedJobData,
  oauth2TokenRefreshScannerJob,
  orphanedAppBundleCleanupJob,
  quotaResetJob,
  recordUsageEventJob,
  sendGettingStartedEmailsJob,
  sendMidTrialEmailsJob,
  sendTrialConversionEmailsJob,
  storageCleanupJob,
  stripeSubscriptionSyncJob,
  taskDeadlineScannerJob,
  thumbnailCleanupJob,
} from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('maintenance-worker')

/**
 * Unified orgSeedJob handler — dispatches on `scenario` to either demo or example seeding.
 * The enqueue side (seedNewOrganization + /demo route) guarantees that a demo signup
 * never enqueues an example job, so no race guard is needed here.
 */
const orgSeedJobHandler: JobHandler = async (ctx) => {
  const { organizationId, scenario } = ctx.data as OrgSeedJobData

  if (scenario === 'demo') {
    if (!isDemoEnabled()) {
      logger.info('Demo disabled, skipping seed', { organizationId })
      return { success: false, reason: 'demo_disabled' }
    }
  } else if (scenario !== 'example') {
    logger.warn('orgSeedJob received unknown scenario', { organizationId, scenario })
    return { success: false, reason: 'unknown_scenario' }
  }

  logger.info(`Starting ${scenario} data seed`, { organizationId })
  const { OrganizationSeeder } = await import('@auxx/seed')
  await OrganizationSeeder.seedOrganization(organizationId, 'additive', scenario)
  logger.info(`${scenario} data seed completed`, { organizationId })
  return { success: true, organizationId, scenario }
}

/**
 * Legacy demoSeedJob alias — forwards any still-enqueued demoSeedJob messages through
 * orgSeedJobHandler with scenario: 'demo'. Remove after one release once the queue
 * drains.
 */
const demoSeedJobAliasHandler: JobHandler = async (ctx) => {
  const { organizationId, userId, userEmail } = ctx.data as DemoSeedJobData
  return orgSeedJobHandler({
    ...ctx,
    data: {
      organizationId,
      userId,
      userEmail,
      scenario: 'demo',
    },
  })
}

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
  orgSeedJob: cloudOnly(orgSeedJobHandler),
  // Thin alias for any in-flight demoSeedJob messages at cutover; remove after one release.
  demoSeedJob: cloudOnly(demoSeedJobAliasHandler),
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

  // Usage-event recording (enqueued by UsageGuard after each counted metric)
  recordUsageEvent: recordUsageEventJob,

  // Storage cleanup (on-demand, enqueued by disconnect/delete flows)
  storageCleanupJob,

  // Task deadline scanner (every minute via upsertJobScheduler)
  taskDeadlineScannerJob,
}

export function startMaintenanceWorker() {
  return createWorker(Queues.maintenanceQueue, jobMappings)
}
