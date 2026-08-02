import { constants } from '@auxx/config'
import { database } from '@auxx/database'
import { isSelfHosted } from '@auxx/deployment'
import { reconcileConnectorSchedulers } from '@auxx/lib/data-connectors'
import { enqueueDataMigrationsRun } from '@auxx/lib/jobs'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import { reconcileSourceSchedulers } from '@auxx/lib/knowledge-sources'
import { startAiAgentWorker } from './worker-definitions/ai-agent-worker'
import { startAiAutofillWorker } from './worker-definitions/ai-autofill-worker'
import { startAppTriggerWorker } from './worker-definitions/app-trigger-worker'
import { startCalendarSyncWorker } from './worker-definitions/calendar-sync-worker'
import { startChatAgentWorker } from './worker-definitions/chat-agent-worker'
import { startDataConnectorWorker } from './worker-definitions/data-connector-worker'
import { startDataExportWorker } from './worker-definitions/data-export-worker'
import { startDataImportWorker } from './worker-definitions/data-import-worker'
import { startDatasetEmbeddingWorker } from './worker-definitions/dataset-embedding-worker'
import { startDatasetMaintenanceWorker } from './worker-definitions/dataset-maintenance-worker'
import { startDocumentPdfWorker } from './worker-definitions/document-pdf-worker'
import { startDocumentProcessingWorker } from './worker-definitions/document-processing-worker'
import { startEmailWorker } from './worker-definitions/email-worker'
import { startEvalRunWorker } from './worker-definitions/eval-run-worker'
import { startEventHandlersWorker, startEventsWorker } from './worker-definitions/events-worker'
import { startKBSyncWorker } from './worker-definitions/kb-sync-worker'
import { startKnowledgeSourceWorker } from './worker-definitions/knowledge-source-worker'
import { startLearnedExtractionWorker } from './worker-definitions/learned-extraction-worker'
import { startMaintenanceWorker } from './worker-definitions/maintenance-worker'
import { startMessageProcessingWorker } from './worker-definitions/message-processing-worker'
import { startMessageSyncWorker } from './worker-definitions/message-sync-worker'
import { startOAuth2RefreshWorker } from './worker-definitions/oauth2-refresh-worker'
import { startPollingSyncWorker } from './worker-definitions/polling-sync-worker'
import { startPollingTriggerWorker } from './worker-definitions/polling-trigger-worker'
import { startQuickbooksInvoiceSyncWorker } from './worker-definitions/quickbooks-invoice-sync-worker'
import { startRecordingBotWorker } from './worker-definitions/recording-bot-worker'
import { startRecordingProcessingWorker } from './worker-definitions/recording-processing-worker'
import { startScheduledTriggerWorker } from './worker-definitions/scheduled-trigger-worker'
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

  // Data export worker (background CSV record export)
  const dataExportWorker = startDataExportWorker()

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

  // Chat-agent worker (visitor chat turns; dedicated lane, isolated from ai-agent)
  const chatAgentWorker = startChatAgentWorker()

  // Eval-run worker (agent-Simulation eval runs; bounded apart from ai-agent)
  const evalRunWorker = startEvalRunWorker()

  // AI autofill worker (per-field AI generation)
  const aiAutofillWorker = startAiAutofillWorker()

  // Learned-KB extraction worker (AI memory from resolved threads)
  const learnedExtractionWorker = startLearnedExtractionWorker()

  // Recording bot lifecycle worker
  const recordingBotWorker = startRecordingBotWorker()

  // Recording media processing worker
  const recordingProcessingWorker = startRecordingProcessingWorker()

  // KB article → managed-dataset sync worker
  const kbSyncWorker = startKBSyncWorker()

  // Knowledge Source ingest/re-sync orchestration worker
  const knowledgeSourceWorker = startKnowledgeSourceWorker()

  // Data Connector structured-record sync orchestration worker
  const dataConnectorWorker = startDataConnectorWorker()

  // Quote/invoice PDF render worker (money MQ2)
  const documentPdfWorker = startDocumentPdfWorker()

  // QuickBooks invoice sync worker (plans/dispatch/37e-quickbooks-invoice-sync.md §3, P3)
  const quickbooksInvoiceSyncWorker = startQuickbooksInvoiceSyncWorker()

  const workers = [
    // defaultWorker,
    eventsWorker,
    eventHandlersWorker,
    maintenanceWorker,
    webhooksWorker,
    messageSyncWorker,
    workflowDelayWorker,
    scheduledTriggerWorker,
    documentProcessingWorker,
    datasetMaintenanceWorker,
    datasetEmbeddingWorker,
    thumbnailWorker,
    oauth2RefreshWorker,
    dataImportWorker,
    dataExportWorker,
    pollingSyncWorker,
    calendarSyncWorker,
    emailWorker,
    messageProcessingWorker,
    appTriggerWorker,
    pollingTriggerWorker,
    aiAgentWorker,
    chatAgentWorker,
    evalRunWorker,
    aiAutofillWorker,
    learnedExtractionWorker,
    recordingBotWorker,
    recordingProcessingWorker,
    kbSyncWorker,
    knowledgeSourceWorker,
    dataConnectorWorker,
    documentPdfWorker,
    quickbooksInvoiceSyncWorker,
  ]

  return Promise.all(workers)
}

export async function setupSchedules() {
  const maintenanceQueue = getQueue(Queues.maintenanceQueue)
  const calendarSyncQueue = getQueue(Queues.calendarSyncQueue)
  const datasetMaintenanceQueue = getQueue(Queues.datasetMaintenanceQueue)

  // Schedulers whose job function was removed/renamed. `upsertJobScheduler` under a new id
  // never deletes the old schedule from Redis, so a retired id keeps firing forever and each
  // tick fails with "Job function not found". Explicit tombstones (not a remove-anything-unknown
  // sweep — org-scoped reconcilers create dynamic ids we don't statically know).
  const retiredSchedulerIds = [
    // Renamed to webhookRenewalScannerJob in #920 (token refresh moved to the unified
    // oauth2TokenRefreshScannerJob).
    'integrationTokenRefreshScannerJob',
  ]
  for (const id of retiredSchedulerIds) {
    await maintenanceQueue.removeJobScheduler(id).catch(() => {})
  }

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

  // Usage-event flush — every minute. Drains the Redis buffer (usage:events:buffer)
  // into batched UsageEvent inserts; eventId + ON CONFLICT DO NOTHING makes
  // replays after a mid-flush failure idempotent.
  await maintenanceQueue.upsertJobScheduler(
    'flushUsageEventsJob',
    { pattern: '* * * * *' },
    {
      opts: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 15000 },
        priority: 6,
        removeOnComplete: { count: 60 },
        removeOnFail: { count: 100 },
      },
    }
  )

  // Task deadline scanner — every minute (catches up automatically on the
  // first tick after a worker outage; idempotent via Task.firedAt).
  await maintenanceQueue.upsertJobScheduler(
    'taskDeadlineScannerJob',
    { pattern: '* * * * *' },
    {
      opts: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 30000 },
        priority: 5,
        removeOnComplete: { count: 60 },
        removeOnFail: { count: 100 },
      },
    }
  )

  // AI suggestion stale scanner — every 5 minutes. Sweeps deals/leads/tickets
  // with cold activity, calls the headless kopilot, persists FRESH bundles
  // for Today UI. Per-entity suppression via EntityInstance.lastSuggestionScanAt
  // means a quiet org sees one no-op tick after entities are caught up.
  await maintenanceQueue.upsertJobScheduler(
    'nextActionStaleScannerJob',
    { pattern: '*/5 * * * *' },
    {
      data: { dryRun: false },
      opts: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 60000 },
        priority: 7,
        removeOnComplete: { count: 60 },
        removeOnFail: { count: 100 },
      },
    }
  )

  // Stale PENDING message sweeper — every 5 minutes. The synchronous send path
  // creates a PENDING row then sends/reconciles in-request; a process death
  // between the two strands the row in PENDING forever (retry rejects it, UI
  // shows a permanent "being sent" spinner). This flips rows older than the
  // threshold to FAILED so they're retryable.
  await maintenanceQueue.upsertJobScheduler(
    'stalePendingMessageSweeperJob',
    { pattern: '*/5 * * * *' },
    {
      data: { dryRun: false },
      opts: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 60000 },
        priority: 7,
        removeOnComplete: { count: 60 },
        removeOnFail: { count: 100 },
      },
    }
  )

  // Orphaned workflow-approval sweep — every 15 minutes. Flips `pending`
  // ApprovalRequests to `timeout` once their WorkflowRun has reached a terminal
  // state (STOPPED/FAILED/SUCCEEDED). The per-run cleanup path already covers
  // orderly stops; this is the backstop for runs that died another way. Global
  // (no org scope) and idempotent, so cadence is unhurried on purpose.
  await maintenanceQueue.upsertJobScheduler(
    'approvalOrphanSweeperJob',
    { pattern: '*/15 * * * *' },
    {
      opts: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 60000 },
        priority: 9,
        removeOnComplete: { count: 24 },
        removeOnFail: { count: 50 },
      },
    }
  )

  // Eval-run watchdog — every 5 minutes. Times out runs whose heartbeat went
  // stale (worker died mid-run) or that were never claimed off the queue.
  await maintenanceQueue.upsertJobScheduler(
    'evalRunWatchdog',
    { pattern: '*/5 * * * *' },
    {
      opts: {
        attempts: 1,
        priority: 8,
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 50 },
      },
    }
  )

  // Data-connector stale-run sweep — every 5 minutes. Fails connector runs whose
  // checkpoint heartbeat went cold (STALE_RUN_MS) and releases the connector claim,
  // so a crashed/restarted continuation chain can't strand a connector 'syncing'
  // forever. Global (no connectorId) — the scoped sweep at startConnectorSync only
  // heals the one connector being re-synced.
  await maintenanceQueue.upsertJobScheduler(
    'dataConnectorStaleSweepJob',
    { pattern: '*/5 * * * *' },
    {
      opts: {
        attempts: 1,
        priority: 8,
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 50 },
      },
    }
  )

  // Data-connector run-history retention — nightly at 03:30. Trims each connector
  // active in the last 25h back to its newest 200 finished runs so the run table
  // stays bounded under a 15-min sync cadence (~96 runs/day/connector otherwise).
  await maintenanceQueue.upsertJobScheduler(
    'dataConnectorRunRetentionJob',
    { pattern: '30 3 * * *' },
    {
      opts: {
        attempts: 1,
        priority: 10,
        removeOnComplete: { count: 14 },
        removeOnFail: { count: 30 },
      },
    }
  )

  // RecordRuleRun retention — nightly at 03:45. Age-prunes rule-firing logs older than
  // 60 days in bounded batches; sync + system-rule firings multiply these rows.
  await maintenanceQueue.upsertJobScheduler(
    'recordRuleRunRetentionJob',
    { pattern: '45 3 * * *' },
    {
      opts: {
        attempts: 1,
        priority: 10,
        removeOnComplete: { count: 14 },
        removeOnFail: { count: 30 },
      },
    }
  )

  // MailFilterRun retention — nightly at 03:55. Age-prunes filter-firing logs older
  // than 60 days in bounded batches (one row per (filter, message) firing). Also
  // bounds Undo: a firing whose run row is gone can no longer be reversed.
  await maintenanceQueue.upsertJobScheduler(
    'mailFilterRunRetentionJob',
    { pattern: '55 3 * * *' },
    {
      opts: {
        attempts: 1,
        priority: 10,
        removeOnComplete: { count: 14 },
        removeOnFail: { count: 30 },
      },
    }
  )

  // Signal retention — nightly at 04:10. Age-prunes high-volume EntitySignal rows
  // (email:opened, web:page_view, email:delivered) older than 180 days in bounded batches;
  // rollups persist (plans/signals/01-signal-store.md "Retention").
  await maintenanceQueue.upsertJobScheduler(
    'signalRetentionJob',
    { pattern: '10 4 * * *' },
    {
      opts: {
        attempts: 1,
        priority: 10,
        removeOnComplete: { count: 14 },
        removeOnFail: { count: 30 },
      },
    }
  )

  // Signal rollup decay sweep — nightly at 04:25 (after signalRetentionJob, and clear of the
  // 03:45 record-rules retention run). Recomputes EntitySignalRollup's *Count30d columns from
  // EntitySignal so a row aging out of its 30-day window decays back down — the inline
  // recordSignal()/recordSignals() path only ever increments (plans/signals/01-signal-store.md
  // "Rollups").
  await maintenanceQueue.upsertJobScheduler(
    'signalRollupSweepJob',
    { pattern: '25 4 * * *' },
    {
      opts: {
        attempts: 1,
        priority: 10,
        removeOnComplete: { count: 14 },
        removeOnFail: { count: 30 },
      },
    }
  )

  // Dispatch recurring engine daily sweep — every day at 03:00 UTC
  // (plans/dispatch/06-recurring-engine.md §4.4/§5.3). Extends the materialization horizon
  // for active recurring engagements that have fallen behind, and auto-ends engagements
  // whose pattern (until/count) has run its course.
  await maintenanceQueue.upsertJobScheduler(
    'recurringVisitsJob',
    { pattern: '0 3 * * *', tz: 'UTC' },
    {
      opts: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 60000 },
        priority: 8,
        removeOnComplete: { count: 14 },
        removeOnFail: { count: 30 },
      },
    }
  )

  // Money MI2 invoice-draft daily sweep — every day at 03:30 UTC (08-mi2-build.md §G), 30
  // minutes after the dispatch recurring engine's visit sweep so a same-day visit
  // materialization can't race the billing pass.
  await maintenanceQueue.upsertJobScheduler(
    'invoiceDraftsJob',
    { pattern: '30 3 * * *', tz: 'UTC' },
    {
      opts: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 60000 },
        priority: 8,
        removeOnComplete: { count: 14 },
        removeOnFail: { count: 30 },
      },
    }
  )

  // Dispatch worker-facing daily schedule digest — every hour on the hour
  // (plans/dispatch/19-client-notifications.md §4.9, opt-in). The job itself only actually
  // sends for orgs whose local time is currently at the digest hour (default 06:00); the
  // per-org/day Redis marker inside `runDispatchDigestSweep` guards against double-sending.
  await maintenanceQueue.upsertJobScheduler(
    'dispatchDigestJob',
    { pattern: '0 * * * *' },
    {
      opts: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 60000 },
        priority: 8,
        removeOnComplete: { count: 24 },
        removeOnFail: { count: 48 },
      },
    }
  )

  // Client-notifications sequence enrollment sweep — hourly, offset to :30 so it doesn't pile
  // onto the :00 tick alongside dispatchDigestJob/orphanedFileCleanupJob/
  // cleanupExpiredMediaAssetsJob (plans/dispatch/19-client-notifications.md §4.3, decision
  // #13). Any-run-ever dedup inside `enrollSubjectInSequence` makes re-running a no-op.
  await maintenanceQueue.upsertJobScheduler(
    'sequenceEnrollmentSweepJob',
    { pattern: '30 * * * *' },
    {
      opts: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 60000 },
        priority: 8,
        removeOnComplete: { count: 24 },
        removeOnFail: { count: 48 },
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

    // Shopify App Pricing state-sync job
    // Every 15 minutes - Reconcile Shopify-billed orgs against the Partner API.
    // App Pricing delivers no billing webhooks, so this is the backstop for
    // off-redirect changes (cancellations, freezes). See plans/billing/v2/07-state-sync-poll.md.
    await maintenanceQueue.upsertJobScheduler(
      'shopifyBillingSyncJob',
      { pattern: '*/15 * * * *' },
      {
        data: { batchSize: 100 },
        opts: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 60000 },
          priority: 6,
          removeOnComplete: { count: 24 },
          removeOnFail: { count: 96 },
        },
      }
    )

    // Shopify per-seat usage drip
    // Daily at 04:00 UTC - Report each Shopify-billed org's seat count to the App Events
    // `seat_day` meter (value = PlanSubscription.seats). Idempotent per (org, day) with a
    // lookback to self-heal a missed run. See plans/billing/v2/14-shopify-per-seat-usage-meter-hack.md.
    await maintenanceQueue.upsertJobScheduler(
      'shopifySeatUsageJob',
      { pattern: '0 4 * * *', tz: 'UTC' },
      {
        data: { batchSize: 200, lookbackDays: 1 },
        opts: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 60000 },
          priority: 6,
          removeOnComplete: { count: 7 },
          removeOnFail: { count: 30 },
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

  // Every day at 6 AM - Archive stale builder drafts (no chat activity, >7d).
  // Soft path; users can still recover via the archived filter. The
  // user-driven "Discard draft" overflow item does the hard-delete instead.
  await maintenanceQueue.upsertJobScheduler(
    'agentDraftCleanupJob',
    { pattern: '0 6 * * *' },
    {
      data: { staleDays: 7, batchSize: 100, dryRun: false },
      opts: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 60000 },
        priority: 10,
        removeOnComplete: { count: 14 },
        removeOnFail: { count: 30 },
      },
    }
  )

  // Every hour at :20 - Sweep expired app KV storage rows. Lazy expiry on read
  // makes cadence non-critical; this is hygiene (reclaims dead rows).
  await maintenanceQueue.upsertJobScheduler(
    'appStorageSweepJob',
    { pattern: '20 * * * *' },
    {
      data: { batchSize: 1000, dryRun: false },
      opts: { attempts: 3, backoff: { type: 'exponential', delay: 60000 }, priority: 10 },
    }
  )

  // Every day at 4:30 AM - Reconcile the RecordIdentity index against the
  // identity FieldValue cells (drift backstop for any un-instrumented writer).
  await maintenanceQueue.upsertJobScheduler(
    'reconcileRecordIdentitiesJob',
    { pattern: '30 4 * * *' },
    {
      data: {},
      opts: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 60000 },
        priority: 10,
        removeOnComplete: { count: 14 },
        removeOnFail: { count: 30 },
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

  // OAuth2 token refresh scanner (for Credential table)

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

  // Nightly MCP tool snapshot re-sync (every day at 4 AM) — re-snapshots tools/list for
  // every connected MCP installation so stale tool definitions self-heal.
  await maintenanceQueue.upsertJobScheduler(
    'mcpToolsResyncJob',
    { pattern: '0 0 4 * * *' },
    { opts: { attempts: 1, removeOnComplete: { count: 7 }, removeOnFail: { count: 30 } } }
  )

  // Channel webhook renewal scanner (Gmail watch / Outlook Graph subscription).
  // Token refresh rides the unified oauth2TokenRefreshScannerJob — this only re-arms webhooks.

  // Every 15 minutes - Scan for watches/subscriptions nearing expiration
  await maintenanceQueue.upsertJobScheduler(
    'webhookRenewalScannerJob',
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

  // ── Knowledge Source Schedules ───────────────────────────────
  // Re-register per-source re-sync schedulers so a cleared Redis can't silently
  // stop them firing. Idempotent (upsert by source-sync-{id}), so re-running on
  // every boot is a no-op when Redis already holds them.
  await reconcileSourceSchedulers(database)

  // ── Data Connector Schedules ─────────────────────────────────
  // Re-register per-connector scheduled syncs so a cleared Redis can't silently
  // stop them firing. Idempotent (upsert by data-connector-sync-{id}).
  await reconcileConnectorSchedulers(database)

  // ── Data Migrations ──────────────────────────────────────────
  // Enqueue a one-shot pending-data-migrations run at boot (NOT a repeatable
  // scheduler). Boot never blocks on it; exactly-once across replicas/services is
  // enforced by the advisory lock + ledger inside the runner. Replaces the local
  // "Run Entity Migrations" button habit in dev too.
  await enqueueDataMigrationsRun()
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
