import { isSelfHosted } from '@auxx/deployment'
import { dataConnectorStaleSweepJob } from '@auxx/lib/data-connectors'
import { isDemoEnabled } from '@auxx/lib/demo'
import { evalRunWatchdog } from '@auxx/lib/evals/worker'
import {
  deletedFileCleanupJob,
  orphanedFileCleanupJob,
  storageQuotaCheckJob,
} from '@auxx/lib/files'
import {
  agentDraftCleanupJob,
  applyScheduledSubscriptionChangesJob,
  appStorageSweepJob,
  cleanupExpiredMediaAssetsJob,
  type DemoSeedJobData,
  dataMigrationsJob,
  demoCleanupJob,
  expiredTrialAccountCleanupJob,
  type JobHandler,
  mcpToolsResyncJob,
  nextActionStaleScannerJob,
  type OrgSeedJobData,
  oauth2TokenRefreshScannerJob,
  orphanedAppBundleCleanupJob,
  quotaResetJob,
  recordUsageEventJob,
  sendGettingStartedEmailsJob,
  sendMidTrialEmailsJob,
  sendTrialConversionEmailsJob,
  shopifyBillingSyncJob,
  shopifySeatUsageJob,
  stalePendingMessageSweeperJob,
  storageCleanupJob,
  stripeSubscriptionSyncJob,
  taskDeadlineScannerJob,
  thumbnailCleanupJob,
  webhookRenewalJob,
  webhookRenewalScannerJob,
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
  // Eval-run watchdog — times out abandoned queued/running runs
  evalRunWatchdog,

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
  shopifyBillingSyncJob: cloudOnly(shopifyBillingSyncJob),
  shopifySeatUsageJob: cloudOnly(shopifySeatUsageJob),

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

  // Nightly MCP tool snapshot re-sync
  mcpToolsResyncJob,

  // Channel webhook renewal (Gmail watch / Outlook Graph subscription). Token refresh for
  // these channels now rides the unified oauth2TokenRefreshScannerJob integration pass.
  webhookRenewalScannerJob,
  webhookRenewalJob,

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

  // AI suggestion stale scanner (every 5 minutes via upsertJobScheduler;
  // sweeps deals/leads/tickets and produces FRESH bundles for Today UI)
  nextActionStaleScannerJob,

  // Agent draft cleanup (daily; archives stale builder drafts with no chat)
  agentDraftCleanupJob,

  // Stale PENDING message sweeper (every 5 min; flips outbound rows stranded in
  // PENDING by a mid-send process death to FAILED so they're retryable)
  stalePendingMessageSweeperJob,

  // App KV storage TTL sweep (hourly; lazy expiry on read makes cadence non-critical)
  appStorageSweepJob,

  // Data migrations runner (enqueued at boot + from the superadmin panel)
  dataMigrationsJob,

  // Global data-connector stale-run sweep (every 5 min; fails cold runs + releases
  // their connector claim so a crashed continuation chain can't strand a connector)
  dataConnectorStaleSweepJob,
}

export function startMaintenanceWorker() {
  return createWorker(Queues.maintenanceQueue, jobMappings)
}
