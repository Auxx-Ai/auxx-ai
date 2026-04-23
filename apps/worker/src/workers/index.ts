import { constants } from '@auxx/config'
import { isSelfHosted } from '@auxx/deployment'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import { startAiAgentWorker } from './worker-definitions/ai-agent-worker'
import { startAiAutofillWorker } from './worker-definitions/ai-autofill-worker'
import { startAppTriggerWorker } from './worker-definitions/app-trigger-worker'
import { startCalendarSyncWorker } from './worker-definitions/calendar-sync-worker'
import { startDataImportWorker } from './worker-definitions/data-import-worker'
import { startDatasetEmbeddingWorker } from './worker-definitions/dataset-embedding-worker'
import { startDatasetMaintenanceWorker } from './worker-definitions/dataset-maintenance-worker'
import { startDocumentProcessingWorker } from './worker-definitions/document-processing-worker'
import { startEmailWorker } from './worker-definitions/email-worker'
import { startEventHandlersWorker, startEventsWorker } from './worker-definitions/events-worker'
import { startMaintenanceWorker } from './worker-definitions/maintenance-worker'
import { startMessageProcessingWorker } from './worker-definitions/message-processing-worker'
import { startMessageSyncWorker } from './worker-definitions/message-sync-worker'
import { startOAuth2RefreshWorker } from './worker-definitions/oauth2-refresh-worker'
import { startPollingSyncWorker } from './worker-definitions/polling-sync-worker'
import { startPollingTriggerWorker } from './worker-definitions/polling-trigger-worker'
import { startRecordingBotWorker } from './worker-definitions/recording-bot-worker'
import { startRecordingProcessingWorker } from './worker-definitions/recording-processing-worker'
import { startScheduledTriggerWorker } from './worker-definitions/scheduled-trigger-worker'
import { startShopifyWorker } from './worker-definitions/shopify-worker'
import { startThumbnailWorker } from './worker-definitions/thumbnail-worker'
import { startWebhooksWorker } from './worker-definitions/webhook-worker'
import { startWorkflowDelayWorker } from './worker-definitions/workflow-delay-worker'
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

  // Polling sync worker (two-phase email sync pipeline)
  const pollingSyncWorker = startPollingSyncWorker()

  // Calendar sync worker
  const calendarSyncWorker = startCalendarSyncWorker()

  // Email delivery worker (transactional/system emails)
  const emailWorker = startEmailWorker()

  // Message processing worker (scheduled sends, etc.)
  const messageProcessingWorker = startMessageProcessingWorker()

  // App trigger dispatch worker (webhook → workflow)
  const appTriggerWorker = startAppTriggerWorker()

  // App polling trigger worker (scheduled poll → dispatch)
  const pollingTriggerWorker = startPollingTriggerWorker()

  // AI agent worker (Kopilot, Builder session processing)
  const aiAgentWorker = startAiAgentWorker()

  // AI autofill worker (per-field AI generation)
  const aiAutofillWorker = startAiAutofillWorker()

  // Recording bot lifecycle worker
  const recordingBotWorker = startRecordingBotWorker()

  // Recording media processing worker
  const recordingProcessingWorker = startRecordingProcessingWorker()

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
    pollingSyncWorker,
    calendarSyncWorker,
    emailWorker,
    messageProcessingWorker,
    appTriggerWorker,
    pollingTriggerWorker,
    aiAgentWorker,
    aiAutofillWorker,
    recordingBotWorker,
    recordingProcessingWorker,
  ]

  return Promise.all(workers)
}

export async function setupSchedules() {
  const maintenanceQueue = getQueue(Queues.maintenanceQueue)
  const calendarSyncQueue = getQueue(Queues.calendarSyncQueue)
  const datasetMaintenanceQueue = getQueue(Queues.datasetMaintenanceQueue)

  await calendarSyncQueue.upsertJobScheduler(
    'calendarSyncScannerJob',
    { pattern: '*/5 * * * *' },
    {
      data: { dryRun: false },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
        priority: 8,
      },
    }
  )

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

  // Billing, subscription, and trial jobs — SaaS-only
  if (!isSelfHosted()) {
    // Subscription scheduled changes job
    // Every hour at 15 minutes past - Apply scheduled subscription changes
    // Runs as backup to Stripe webhooks
    await maintenanceQueue.upsertJobScheduler(
      'applyScheduledSubscriptionChangesJob',
      { pattern: '15 * * * *' },
      {
        data: { batchSize: 50, dryRun: false },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
          priority: 5,
        },
      }
    )

    // Stripe subscription sync job
    // Every hour at 45 minutes past - Sync subscription state with Stripe
    await maintenanceQueue.upsertJobScheduler(
      'stripeSubscriptionSyncJob',
      { pattern: '45 * * * *' },
      {
        data: { batchSize: 50, dryRun: false },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
          priority: 5,
          removeOnComplete: { count: 24 },
          removeOnFail: { count: 168 },
        },
      }
    )

    // Demo cleanup job
    // Every 15 minutes - Clean up expired demo organizations
    await maintenanceQueue.upsertJobScheduler(
      'demoCleanupJob',
      { pattern: '*/15 * * * *' },
      {
        data: { batchSize: 50, dryRun: false },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
          priority: 10,
          removeOnComplete: { count: 24 },
          removeOnFail: { count: 48 },
        },
      }
    )

    // Expired trial account cleanup job
    // Every day at 3 AM UTC - Clean up expired trial accounts after 14-day grace period
    await maintenanceQueue.upsertJobScheduler(
      'expiredTrialAccountCleanup',
      { pattern: '0 3 * * *', tz: 'UTC' },
      {
        data: { dryRun: false, gracePeriodDays: 14, batchSize: 10, sendNotifications: true },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
          priority: 10,
          removeOnComplete: { count: 7 },
          removeOnFail: { count: 30 },
        },
      }
    )

    // Lifecycle email jobs

    // Every 30 minutes - Send getting started emails to new trial users
    await maintenanceQueue.upsertJobScheduler(
      'sendGettingStartedEmailsJob',
      { pattern: '*/30 * * * *', tz: 'UTC' },
      {
        data: { dryRun: false, batchSize: 50 },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 30000 },
          priority: 5,
          removeOnComplete: { count: 7 },
          removeOnFail: { count: 14 },
        },
      }
    )

    // Every day at 10 AM UTC - Send mid-trial engagement emails
    await maintenanceQueue.upsertJobScheduler(
      'sendMidTrialEmailsJob',
      { pattern: '0 10 * * *', tz: 'UTC' },
      {
        data: { dryRun: false, batchSize: 50, midTrialDay: 7 },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
          priority: 5,
          removeOnComplete: { count: 7 },
          removeOnFail: { count: 14 },
        },
      }
    )

    // Every day at 10 AM UTC - Send trial conversion emails
    await maintenanceQueue.upsertJobScheduler(
      'sendTrialConversionEmailsJob',
      { pattern: '0 10 * * *', tz: 'UTC' },
      {
        data: { dryRun: false, batchSize: 50, daysBeforeEnd: 3 },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
          priority: 5,
          removeOnComplete: { count: 7 },
          removeOnFail: { count: 14 },
        },
      }
    )
  }

  // Every day at 5 AM - Clean up orphaned app bundles (S3 + DB)
  await maintenanceQueue.upsertJobScheduler(
    'orphanedAppBundleCleanupJob',
    { pattern: '0 5 * * *' },
    {
      data: { batchSize: 100, dryRun: false },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
        priority: 10,
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

  // ── Polling Sync Schedules ──

  const pollingSyncQueue = getQueue(Queues.pollingSyncQueue)

  const messageListFetchIntervalMs = Number.parseInt(
    process.env.SYNC_MESSAGE_LIST_FETCH_INTERVAL_MS ??
      String(constants.timing.pollingSync.messageListFetchIntervalMs),
    10
  )
  const messagesImportIntervalMs = Number.parseInt(
    process.env.SYNC_MESSAGES_IMPORT_INTERVAL_MS ??
      String(constants.timing.pollingSync.messagesImportIntervalMs),
    10
  )
  const staleCheckIntervalMs = constants.timing.pollingSync.staleCheckIntervalMs
  const relaunchFailedIntervalMs = constants.timing.pollingSync.relaunchFailedIntervalMs

  // Scan for integrations needing sync (default: every 5 min)
  await pollingSyncQueue.upsertJobScheduler(
    'pollingSyncScannerJob',
    { every: messageListFetchIntervalMs },
    {
      data: { dryRun: false },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
        priority: 5,
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 50 },
      },
    }
  )

  // Run import phase scanner (default: every 1 min)
  // Re-uses pollingSyncScannerJob handler which covers both list-fetch and import stages
  await pollingSyncQueue.upsertJobScheduler(
    'messagesImportScannerJob',
    { every: messagesImportIntervalMs },
    {
      name: 'pollingSyncScannerJob',
      data: {},
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 },
        priority: 5,
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 50 },
      },
    }
  )

  // Check for stuck jobs (default: every 15 min)
  await pollingSyncQueue.upsertJobScheduler(
    'pollingStaleCheckJob',
    { every: staleCheckIntervalMs },
    {
      data: { staleThresholdMs: 900000 },
      opts: {
        attempts: 1,
        priority: 10,
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 50 },
      },
    }
  )

  // Relaunch failed polling integrations (default: every 30 min)
  await pollingSyncQueue.upsertJobScheduler(
    'pollingRelaunchFailedJob',
    { every: relaunchFailedIntervalMs },
    {
      data: {},
      opts: {
        attempts: 1,
        priority: 10,
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 50 },
      },
    }
  )

  // ── Recording Bot Schedules ──────────────────────────────────
  const recordingBotQueue = getQueue(Queues.recordingBotQueue)

  // Auto-schedule bots for upcoming meetings (every 2 min)
  await recordingBotQueue.upsertJobScheduler(
    'scheduleBotsForUpcomingMeetingsJob',
    { pattern: '*/2 * * * *' },
    {
      data: {},
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
        priority: 5,
      },
    }
  )

  // Poll active bot statuses as safety net for missed webhooks (every 1 min)
  await recordingBotQueue.upsertJobScheduler(
    'pollActiveBotsJob',
    { pattern: '*/1 * * * *' },
    {
      data: {},
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 },
        priority: 5,
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
