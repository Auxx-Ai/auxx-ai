import { isSelfHosted } from '@auxx/deployment'
import { dataConnectorRunRetentionJob, dataConnectorStaleSweepJob } from '@auxx/lib/data-connectors'
import { isDemoEnabled } from '@auxx/lib/demo'
import { evalRunWatchdog } from '@auxx/lib/evals/worker'
import {
  agentDraftCleanupJob,
  applyScheduledSubscriptionChangesJob,
  approvalOrphanSweeperJob,
  appStorageSweepJob,
  bankFeedMaintenanceJob,
  cleanupExpiredMediaAssetsJob,
  companyEnrichmentSweepJob,
  type DemoSeedJobData,
  dataDeletionJob,
  dataMigrationsJob,
  deletedFileCleanupJob,
  demoCleanupJob,
  dispatchDigestJob,
  duplicateScanJob,
  expiredTrialAccountCleanupJob,
  flushUsageEventsJob,
  interactionResolutionSweepJob,
  invoiceDraftsJob,
  type JobHandler,
  mailCountsReconcileJob,
  mailSuggestionsJob,
  mailUnsubscribeSweepJob,
  mcpToolsResyncJob,
  nextActionStaleScannerJob,
  type OrgSeedJobData,
  oauth2TokenRefreshScannerJob,
  orphanedAppBundleCleanupJob,
  orphanedFileCleanupJob,
  orphanedStorageObjectJob,
  outlookSubscriptionHealthJob,
  quotaResetJob,
  reconcileRecordIdentitiesJob,
  recordUsageEventJob,
  recurringVisitsJob,
  reseedConnectionProvidersJob,
  sendGettingStartedEmailsJob,
  sendMidTrialEmailsJob,
  sendTrialConversionEmailsJob,
  sequenceEnrollmentSweepJob,
  shopifyBillingSyncJob,
  shopifySeatUsageJob,
  stalePendingMessageSweeperJob,
  storageCleanupJob,
  storageQuotaCheckJob,
  stripeSubscriptionSyncJob,
  taskDeadlineScannerJob,
  thumbnailCleanupJob,
  vendorBillAgingJob,
  webhookRenewalJob,
  webhookRenewalScannerJob,
} from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { mailReclassifyApplyJob, mailReclassifySampleJob } from '@auxx/lib/mail-classification'
import { mailFilterRetroactiveApplyJob, mailFilterRunRetentionJob } from '@auxx/lib/mail-filters'
import { recordRuleRunRetentionJob } from '@auxx/lib/record-rules'
import { signalRetentionJob, signalRollupSweepJob } from '@auxx/lib/signals'
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

/**
 * ⚠️ Exported for one reason: so a test can prove a queued job has a handler.
 *
 * Nothing in the type system connects `queue.add(NAME, …)` to this map. A job
 * enqueued under a name that is absent here compiles, passes review, and fails
 * only at runtime inside the worker with `Job function not found` — which is
 * exactly how the retroactive-classification sample shipped inert
 * (`plans/mail-filter/07-…§7.5.1`). The mapping is the contract; this makes it
 * assertable.
 */
export const jobMappings = {
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

  // Outlook Graph subscription health sweep (hourly): re-arms dead/expired subscriptions
  // and delta-resyncs after a silently-missed notification gap.
  outlookSubscriptionHealthJob,

  // App bundle cleanup
  orphanedAppBundleCleanupJob,

  // Quota management jobs
  quotaResetJob,

  // Usage-event flush (every minute via upsertJobScheduler; drains the Redis
  // buffer UsageCounter writes to into batched Postgres inserts)
  flushUsageEventsJob,

  // Legacy per-event usage recording — kept for jobs enqueued by pre-buffer
  // deploys still in flight at rollout
  recordUsageEvent: recordUsageEventJob,

  // Storage cleanup (on-demand, enqueued by disconnect/delete flows)
  storageCleanupJob,

  // Orphaned storage object compensation (on-demand, enqueued by the upload
  // completion route when its inline delete throws). Carries the bucket, so a
  // PUBLIC upload's object is deleted from the public bucket instead of 204ing
  // against the private one.
  orphanedStorageObjectJob,

  // Mail counts reconcile (on-demand, jobId-deduped; enqueued by stale
  // getCounts reads, interactive mutations, and bulk slow paths)
  mailCountsReconcile: mailCountsReconcileJob,

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

  // Orphaned workflow-approval sweep (every 15 min; times out `pending` approvals
  // whose WorkflowRun already reached a terminal state, e.g. after a crash that
  // skipped the per-run cleanup path)
  approvalOrphanSweeperJob,

  // Data migrations runner (enqueued at boot + from the superadmin panel)
  dataMigrationsJob,

  // Provider data-deletion / deauthorize teardown (plans/channels/
  // meta-data-deletion-callback.md §4.4). ON-DEMAND, one job per inbound
  // callback — deliberately NOT scheduled. Revokes + soft-deletes for
  // `data_deletion`, disables only for `deauthorize`, and parks the three
  // Shopify compliance kinds in `processing`. Safe to retry: an already
  // `completed` request is a no-op inside `executeDeletionRequest`.
  dataDeletionJob,

  // Platform connection-provider reseed (superadmin panel only). Re-bakes the
  // ConnectionDefinition rows from the deployed catalog + this process's config,
  // so rotating a platform OAuth client is a button, not a release.
  reseedConnectionProvidersJob,

  // RecordIdentity drift backstop (daily; rebuilds the index from
  // FieldValue ⋈ CustomField(isIdentity) for any un-instrumented writer)
  reconcileRecordIdentitiesJob,

  // The bank feed's nightly sweep (HANDOFF slot 3A). Releases Financial Connections
  // accounts that are still being billed 30c/month with nothing feeding from them, and
  // stores each bank account's coverage floor. Both failures are SILENT without it: a
  // churned customer bills forever, and a balance sheet spanning a hole in the data
  // renders happily and is wrong.
  bankFeedMaintenanceJob,

  // Dispatch recurring engine daily sweep (M2c, 06-recurring-engine.md §4.4/§5.3):
  // extends materialization horizons for active engagements + auto-ends exhausted ones.
  recurringVisitsJob,

  // Money MI2 invoice-draft daily sweep (08-mi2-build.md §G): materializes `custom_schedule`
  // invoice-draft recurrence rules whose horizon has fallen behind.
  invoiceDraftsJob,

  // Money P24 vendor-bill aging daily sweep. THE ONLY time-driven trigger in the
  // three-way match: every other one is an edit or a receipt. Without it a prepaid
  // bill whose goods never arrive stays `awaiting_receipt` forever instead of
  // becoming the `exception` that catches a vendor who took the money and never
  // shipped. Re-uses `rematchBill`, so it decides which bills to re-ask about and
  // never what a bill's status is.
  vendorBillAgingJob,

  // Company enrichment gap-filling sweep (plans/company/v4-enrichment-doors.md §5, Door
  // 5b). Every other enrichment door is event-driven, so this is the only path back for
  // companies created before a door existed, ones the per-org window limiter dropped
  // mid-import, and ones stranded on `pending` by a worker that died mid-fetch.
  companyEnrichmentSweepJob,

  // Contact/company interaction resolution gap filler (plans/company/
  // v5-interaction-resolution.md §7). Both live callers are event-driven — pass 5 of the
  // sync finalize integrity passes, and a field-change hook — so this catches what they
  // drop: a run whose manifest membership truncated, and a hook whose fire-and-forget died
  // with its process. Windowed to 30 days; historical recovery is the backfill script's job.
  interactionResolutionSweepJob,

  // Dispatch worker-facing daily schedule digest sweep (plans/dispatch/19-client-notifications.md
  // §4.9, opt-in): hourly tick, per-org local-hour + Redis dedupe guard inside the job itself.
  dispatchDigestJob,

  // Client-notifications sequence enrollment hourly sweep (plans/dispatch/
  // 19-client-notifications.md §4.3, decision #13): enrolls scheduled visits (one-off AND
  // recurring) into enabled `visit:scheduled` sequences within each sequence's computed
  // lookahead window; any-run-ever dedup makes re-running this job a no-op.
  sequenceEnrollmentSweepJob,

  // Global data-connector stale-run sweep (every 5 min; fails cold runs + releases
  // their connector claim so a crashed continuation chain can't strand a connector)
  dataConnectorStaleSweepJob,

  // Nightly data-connector run-history retention (trims each recently-active
  // connector back to its newest 200 finished runs so the table stays bounded)
  dataConnectorRunRetentionJob,

  // Nightly RecordRuleRun retention (age-prunes rule-firing logs older than 60d;
  // sync + system-rule firings multiply these rows)
  recordRuleRunRetentionJob,

  // Nightly MailFilterRun retention (age-prunes filter-firing logs older than
  // 60d — one row per (filter, message) firing). This also bounds Undo: a firing
  // whose run row is gone can no longer be reversed.
  mailFilterRunRetentionJob,

  // Retroactive mail-filter apply (on-demand, enqueued from `mailFilters.
  // applyRetroactively` and jobId-deduped per filter). Pages through the
  // filter's inbox with a keyset cursor and runs the SAME action executor the
  // live gate runs, writing one MailFilterRun per thread at
  // `source: 'retroactive'` — so the backfill is auditable and undoable, and its
  // claim key never collides with the live firing on the same message.
  mailFilterRetroactiveApplyJob,

  // Retroactive mail-classification SAMPLE (plans/mail-filter/07-…§2.11, on-demand,
  // enqueued from `mailClassification.startSample` and jobId-deduped per inbox).
  // Classifies ~100 threads, reports the label distribution and abstention rate,
  // and applies NOTHING — no tag, no marker (07 invariant 9), so the threads stay
  // eligible for the real run that follows.
  //
  // ⚠️ Pinned to `attempts: 1` at the enqueue: every retry would re-spend ~100
  // inferences for the same answer.
  mailReclassifySampleJob,

  // Retroactive mail-classification FULL RUN (07-…§4 phase 2). Pages the scope
  // newest-first with a keyset cursor, classifies the first inbound message of
  // each thread, applies the tag and stamps the C9 marker.
  //
  // ⚠️ Deliberately does NOT re-run mail filters (07 R2 / invariant 3) — the one
  // exception to 05's invariant 15. Do not "fix" the inconsistency.
  mailReclassifyApplyJob,

  // Weekly mail-suggestion mining (plans/mail-filter/03-suggestions-plan.md §5.1):
  // per org → per inbox → ONE indexed grouped query over a 90-day window, then the
  // thresholds and the four suppression rules. Also sweeps `new` suggestions older
  // than 90 days; `dismissed` rows persist forever because they ARE the suppression
  // list (invariant 7).
  mailSuggestionsJob,

  // Daily unsubscribe-ignored sweep (plan §6.4): counts mail that kept arriving
  // from a `subjectKey` we already unsubscribed from, so "Stripe ignored your
  // unsubscribe — 6 more since. Filter it?" is answerable.
  mailUnsubscribeSweepJob,

  // Duplicate-suggestion scan (plans/records/duplicate-suggestion-plan-v2.md §1.4).
  // ONE handler behind FOUR doors — the coalesced mutation seam
  // (jobId `dup-scan:{org}:{def}`, 45s delay), the `sync:records:changed`
  // manifest consumer (jobId `dup-scan:{runId|importRef}`), and the 6h sweep
  // (no scope) — all resolve their scope from the job data and run the same
  // watermark-driven pass.
  duplicateScanJob,

  // Signals substrate (plans/signals/01-signal-store.md "Retention" / "Rollups"):
  // nightly high-volume EntitySignal prune (180d) + EntitySignalRollup *Count30d decay sweep.
  signalRetentionJob,
  signalRollupSweepJob,
}

export function startMaintenanceWorker() {
  return createWorker(Queues.maintenanceQueue, jobMappings)
}
