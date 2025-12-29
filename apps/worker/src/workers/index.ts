// import { maintenanceQueue } from '@auxx/lib/queues'
// import { startMaintenanceWorker } from './worker-definitions/maintenanceWorker'
import { startEventHandlersWorker, startEventsWorker } from './worker-definitions/events-worker'
import { startWebhooksWorker } from './worker-definitions/webhook-worker'
import { startMaintenanceWorker } from './worker-definitions/maintenance-worker'
import { startShopifyWorker } from './worker-definitions/shopify-worker'
import { startWorkflowDelayWorker } from './worker-definitions/workflow-delay-worker'
import { startScheduledTriggerWorker } from './worker-definitions/scheduled-trigger-worker'
import { startDocumentProcessingWorker } from './worker-definitions/document-processing-worker'
import { startDatasetMaintenanceWorker } from './worker-definitions/dataset-maintenance-worker'
import { startDatasetEmbeddingWorker } from './worker-definitions/dataset-embedding-worker'
import { startThumbnailWorker } from './worker-definitions/thumbnail-worker'
import { startOAuth2RefreshWorker } from './worker-definitions/oauth2-refresh-worker'
import { startDataImportWorker } from './worker-definitions/data-import-worker'

import { getQueue } from '@auxx/lib/queues'
import { Queues } from '@auxx/lib/jobs/queues/types'
import { startMessageSyncWorker } from './worker-definitions/message-sync-worker'
// import { startDefaultWorker } from './worker-definitions/defaultWorker'

export async function startWorkers() {
  // Responsible for starting the event processing workers.
  // The eventWorker will store the event in db, add all `handler` functions the eventHandler queue,
  // create a posthog event
  // Adds the event to the webhooks queue for outgoing webhooks
  const eventsWorker = startEventsWorker()
  // Responsible for processing the event handlers.
  const eventHandlersWorker = startEventHandlersWorker()
  const maintenanceWorker = startMaintenanceWorker()
  // Responsible for processing outgoing webhooks.
  const webhooksWorker = startWebhooksWorker()

  const messageSyncWorker = startMessageSyncWorker()
  // processes all shopify related jobs
  const shopifyWorker = startShopifyWorker()
  // processes workflow delay jobs
  const workflowDelayWorker = startWorkflowDelayWorker()
  // processes scheduled triggers for workflows
  const scheduledTriggerWorker = startScheduledTriggerWorker()

  // Dataset processing workers
  const documentProcessingWorker = startDocumentProcessingWorker()
  const datasetMaintenanceWorker = startDatasetMaintenanceWorker()
  const datasetEmbeddingWorker = startDatasetEmbeddingWorker()

  // Thumbnail generation worker
  const thumbnailWorker = startThumbnailWorker()

  // OAuth2 token refresh worker
  const oauth2RefreshWorker = startOAuth2RefreshWorker()

  // Data import worker (plan generation and execution)
  const dataImportWorker = startDataImportWorker()

  const workers = [
    // defaultWorker,
    eventsWorker,
    eventHandlersWorker,
    maintenanceWorker,
    webhooksWorker,
    shopifyWorker,
    messageSyncWorker,
    workflowDelayWorker,
    scheduledTriggerWorker,
    documentProcessingWorker,
    datasetMaintenanceWorker,
    datasetEmbeddingWorker,
    thumbnailWorker,
    oauth2RefreshWorker,
    dataImportWorker,
  ]

  return Promise.all(workers)
}

export async function setupSchedules() {
  const maintenanceQueue = getQueue(Queues.maintenanceQueue)
  const datasetMaintenanceQueue = getQueue(Queues.datasetMaintenanceQueue)

  // Every day at 8 AM
  await maintenanceQueue.upsertJobScheduler(
    'requestDocumentSuggestionsJob',
    { pattern: '0 0 8 * * *' },
    { opts: { attempts: 1 } }
  )

  // File cleanup jobs

  // Every hour - Clean up orphaned files
  await maintenanceQueue.upsertJobScheduler(
    'orphanedFileCleanupJob',
    { pattern: '0 * * * *' },
    {
      data: { batchSize: 100, dryRun: false },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
        priority: 10, // Low priority
      },
    }
  )

  // Every day at 2 AM - Clean up soft-deleted files
  await maintenanceQueue.upsertJobScheduler(
    'deletedFileCleanupJob',
    { pattern: '0 2 * * *' },
    {
      data: { batchSize: 200, dryRun: false },
      opts: { attempts: 3, backoff: { type: 'exponential', delay: 60000 }, priority: 10 },
    }
  )

  // Every day at 4 AM - Check storage quotas
  await maintenanceQueue.upsertJobScheduler(
    'storageQuotaCheckJob',
    { pattern: '0 4 * * *' },
    { data: { dryRun: false }, opts: { attempts: 1, priority: 5 } }
  )

  // Every hour - Clean up expired MediaAssets (workflow files, etc.)
  await maintenanceQueue.upsertJobScheduler(
    'cleanupExpiredMediaAssetsJob',
    { pattern: '0 * * * *' }, // Every hour at minute 0
    {
      data: {
        organizationId: 'global-cleanup', // Will be overridden per org
        options: {
          maxAgeHours: 1, // Clean up files older than 1 hour with expiration metadata
          batchSize: 50,
          dryRun: false,
        },
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 }, // 30 second backoff
        priority: 15, // Higher priority than other cleanup jobs (lower number = higher priority)
      },
    }
  )

  // Thumbnail cleanup jobs

  // Every day at 3 AM (with 0-5 min jitter) - Comprehensive thumbnail cleanup
  const thumbnailJitter = Math.floor(Math.random() * 5)
  await maintenanceQueue.upsertJobScheduler(
    'thumbnailCleanupJob',
    { pattern: `${thumbnailJitter} 3 * * *` },
    {
      data: {
        cleanupTypes: ['orphaned', 'failed', 'expired'],
        options: {
          batchSize: 500,
          maxDeletesPerRun: 5000,
          dryRun: false,
        },
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
        priority: 10, // Low priority
      },
    }
  )

  // Weekly on Sunday at 4 AM (with jitter) - Outdated version cleanup
  const versionJitter = Math.floor(Math.random() * 5)
  await maintenanceQueue.upsertJobScheduler(
    'thumbnailVersionCleanupJob',
    { pattern: `${versionJitter} 4 * * 0` },
    {
      data: {
        cleanupTypes: ['outdated'],
        options: {
          batchSize: 200,
          keepVersions: 3,
          maxDeletesPerRun: 2000,
          dryRun: false,
        },
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
        priority: 10,
      },
    }
  )

  // Subscription scheduled changes job

  // Every hour at 15 minutes past - Apply scheduled subscription changes
  // Runs as backup to Stripe webhooks
  await maintenanceQueue.upsertJobScheduler(
    'applyScheduledSubscriptionChangesJob',
    { pattern: '15 * * * *' }, // Every hour at :15 (e.g., 1:15, 2:15, 3:15)
    {
      data: {
        batchSize: 50,
        dryRun: false,
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 }, // 1 min, 2 min, 4 min
        priority: 5, // Higher priority than cleanup jobs (lower number = higher priority)
      },
    }
  )

  // Stripe subscription sync job

  // Every hour at 45 minutes past - Sync subscription state with Stripe
  // Acts as backup to webhooks to catch missed events and fix data discrepancies
  await maintenanceQueue.upsertJobScheduler(
    'stripeSubscriptionSyncJob',
    { pattern: '45 * * * *' }, // Every hour at :45 (e.g., 1:45, 2:45, 3:45)
    {
      data: {
        batchSize: 50,
        dryRun: false,
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 }, // 1 min, 2 min, 4 min
        priority: 5, // Higher priority than cleanup jobs
        removeOnComplete: { count: 24 }, // Keep last 24 hours of logs
        removeOnFail: { count: 168 }, // Keep failed jobs for 7 days
      },
    }
  )

  // Expired trial account cleanup job

  // Every day at 3 AM UTC - Clean up expired trial accounts after 14-day grace period
  await maintenanceQueue.upsertJobScheduler(
    'expiredTrialAccountCleanup',
    {
      pattern: '0 3 * * *', // Daily at 3 AM UTC
      tz: 'UTC',
    },
    {
      data: {
        dryRun: false,
        gracePeriodDays: 14,
        batchSize: 10,
        sendNotifications: true,
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 }, // 1 min, 2 min, 4 min
        priority: 10, // Low priority, non-urgent
        removeOnComplete: { count: 7 }, // Keep last 7 days of logs
        removeOnFail: { count: 30 }, // Keep failed jobs for 30 days
      },
    }
  )

  // Lifecycle email jobs

  // Every 30 minutes - Send getting started emails to new trial users (1-2 hours after signup)
  await maintenanceQueue.upsertJobScheduler(
    'sendGettingStartedEmailsJob',
    {
      pattern: '*/30 * * * *', // Every 30 minutes
      tz: 'UTC',
    },
    {
      data: {
        dryRun: false,
        batchSize: 50,
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 },
        priority: 5, // Medium priority
        removeOnComplete: { count: 7 },
        removeOnFail: { count: 14 },
      },
    }
  )

  // Every day at 10 AM UTC - Send mid-trial engagement emails (day 7 of trial)
  await maintenanceQueue.upsertJobScheduler(
    'sendMidTrialEmailsJob',
    {
      pattern: '0 10 * * *', // Daily at 10 AM UTC
      tz: 'UTC',
    },
    {
      data: {
        dryRun: false,
        batchSize: 50,
        midTrialDay: 7,
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
        priority: 5, // Medium priority
        removeOnComplete: { count: 7 },
        removeOnFail: { count: 14 },
      },
    }
  )

  // Every day at 10 AM UTC - Send trial conversion emails (3 days before trial ends)
  await maintenanceQueue.upsertJobScheduler(
    'sendTrialConversionEmailsJob',
    {
      pattern: '0 10 * * *', // Daily at 10 AM UTC
      tz: 'UTC',
    },
    {
      data: {
        dryRun: false,
        batchSize: 50,
        daysBeforeEnd: 3,
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
        priority: 5, // Medium priority
        removeOnComplete: { count: 7 },
        removeOnFail: { count: 14 },
      },
    }
  )

  // Dataset maintenance schedules

  // Every day at 3 AM - Clean up orphaned dataset data
  await datasetMaintenanceQueue.upsertJobScheduler(
    'datasetOrphanedDataCleanup',
    { pattern: '0 3 * * *' },
    {
      data: { organizationId: 'global-cleanup' }, // Will be overridden per org
      opts: {
        attempts: 1,
        priority: 10,
      },
    }
  )

  // OAuth2 token refresh scanner (for WorkflowCredentials table)

  // Every 15 minutes - Scan for OAuth2 tokens that need refreshing
  await maintenanceQueue.upsertJobScheduler(
    'oauth2TokenRefreshScannerJob',
    { pattern: '*/15 * * * *' }, // Every 15 minutes
    {
      data: {
        dryRun: false,
        batchSize: 50,
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 }, // 1 min, 2 min, 4 min
        priority: 8, // Medium-high priority (lower number = higher priority)
        removeOnComplete: { count: 10 }, // Keep last 10 successful runs
        removeOnFail: { count: 50 }, // Keep last 50 failed runs for debugging
      },
    }
  )

  // Integration token refresh scanner (for Integration table - Gmail/Outlook)

  // Every 15 minutes - Scan for integration tokens that need refreshing
  // Also handles Gmail watch and Outlook subscription renewal
  await maintenanceQueue.upsertJobScheduler(
    'integrationTokenRefreshScannerJob',
    { pattern: '*/15 * * * *' }, // Every 15 minutes
    {
      data: {
        dryRun: false,
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 }, // 1 min, 2 min, 4 min
        priority: 8, // Medium-high priority (lower number = higher priority)
        removeOnComplete: { count: 10 }, // Keep last 10 successful runs
        removeOnFail: { count: 50 }, // Keep last 50 failed runs for debugging
      },
    }
  )

  // AI Provider quota reset job

  // Every day at 1 AM UTC - Reset expired quota periods
  await maintenanceQueue.upsertJobScheduler(
    'quotaResetJob',
    {
      pattern: '0 1 * * *', // Daily at 1 AM UTC
      tz: 'UTC',
    },
    {
      data: {
        dryRun: false,
        batchSize: 100,
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 }, // 1 min, 2 min, 4 min
        priority: 10, // Low priority, non-urgent
        removeOnComplete: { count: 30 }, // Keep last 30 days of logs
        removeOnFail: { count: 60 }, // Keep failed jobs for 60 days
      },
    }
  )
}

//   // Every 10 minutes
//   await maintenanceQueue.upsertJobScheduler(
//     'autoScaleJob',
//     { pattern: '*/10 * * * *' },
//     { opts: { attempts: 1 } }
//   )

//   // Every day at 2 AM
//   await maintenanceQueue.upsertJobScheduler(
//     'cleanDocumentSuggestionsJob',
//     { pattern: '0 0 2 * * *' },
//     { opts: { attempts: 1 } }
//   )

//   // Every minute
//   await maintenanceQueue.upsertJobScheduler(
//     'checkScheduledDocumentTriggersJob',
//     { pattern: '* * * * *' },
//     { opts: { attempts: 1 } }
//   )

//   // Every day at 3 AM - Refresh project stats cache
//   await maintenanceQueue.upsertJobScheduler(
//     'refreshProjectStatsCacheJob',
//     { pattern: '0 0 3 * * *' },
//     { opts: { attempts: 1 } }
//   )
// }
