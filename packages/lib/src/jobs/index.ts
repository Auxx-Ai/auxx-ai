// Billing

// Mail classification (plans/mail-filter/05-mail-classification-plan.md §4)
export { MAIL_CLASSIFICATION_JOB_NAME } from '../mail-classification/client'
export { enqueueMailClassification } from '../mail-classification/enqueue'
export {
  type MailClassificationJobData,
  type MailClassificationJobResult,
  mailClassificationJob,
} from '../mail-classification/job'
// Mail schedule
export {
  enqueueScheduledMessageJob,
  type SendScheduledMessageJobData,
  sendScheduledMessageJob,
} from '../mail-schedule'
// Usage
export { flushUsageEventsJob, type RecordUsageEventJobData, recordUsageEventJob } from '../usage'
export {
  type AgentAppTriggerDispatchJobData,
  dispatchAppTriggerToAgents,
} from './agent/app-trigger-dispatch-job'
export {
  type AgentAppTriggerJobData,
  executeAgentAppTrigger,
} from './agent/app-trigger-job'
export {
  type AgentAssignmentTriggerJobData,
  executeAgentAssignmentTrigger,
} from './agent/assignment-trigger-job'
export {
  type AgentEventTriggerJobData,
  executeAgentEventTrigger,
} from './agent/event-trigger-job'
export {
  type AgentMentionTriggerJobData,
  executeAgentMentionTrigger,
} from './agent/mention-trigger-job'
export {
  type AgentScheduledTriggerJobData,
  executeAgentScheduledTrigger,
} from './agent/scheduled-trigger-job'
export {
  type AgentWebhookEndpointDispatchJobData,
  dispatchWebhookEndpointToAgents,
} from './agent/webhook-endpoint-dispatch-job'
// AI autofill
export { type AiAutofillJobData, aiAutofillJob } from './ai-autofill/ai-autofill-job'
// AI suggestion scanner + learned-KB extraction
export {
  enqueueLearnedExtraction,
  type LearnedExtractionJobData,
  learnedExtractionJob,
  type NextActionStaleScannerJobData,
  nextActionStaleScannerJob,
} from './approvals'
export {
  type ApplyScheduledChangesJobData,
  type ApplyScheduledChangesResult,
  applyScheduledSubscriptionChangesJob,
} from './billing/apply-scheduled-subscription-changes-job'
export {
  type ShopifyBillingSyncJobData,
  type ShopifyBillingSyncResult,
  shopifyBillingSyncJob,
} from './billing/shopify-billing-sync-job'
export {
  type ShopifySeatUsageJobData,
  type ShopifySeatUsageResult,
  shopifySeatUsageJob,
} from './billing/shopify-seat-usage-job'
export {
  type StripeSubscriptionSyncJobData,
  type StripeSubscriptionSyncResult,
  stripeSubscriptionSyncJob,
} from './billing/stripe-subscription-sync-job'
// Calendar
export {
  type CalendarSyncJobData,
  type CalendarSyncScannerJobData,
  calendarSyncJob,
  calendarSyncScannerJob,
} from './calendar'
// Data-connector app-trigger sync bridge (plans/data-connectors/v4)
export {
  type ConnectorAppTriggerDispatchJobData,
  dispatchAppTriggerToConnectors,
} from './data-connector/app-trigger-sync-dispatch-job'
export {
  type ConnectorWebhookEndpointDispatchJobData,
  dispatchWebhookEndpointToConnectors,
} from './data-connector/webhook-endpoint-sync-dispatch-job'
// Webhook-steered PARTIAL run child job (plans/data-connectors/v2/webhook-steered-partial-run-plan)
export {
  type ConnectorWebhookSteerJobData,
  runConnectorWebhookSteer,
  WEBHOOK_STEER_JOB,
} from './data-connector/webhook-steer-job'
// Datasets
export {
  batchOperationJob,
  finalizeDocumentJob,
  generateEmbeddingJob,
  generateEmbeddingsFlowJob,
  processDocumentJob,
} from './datasets/document-processing-jobs'
export {
  cleanupDatasetJob,
  cleanupOrphanedDataJob,
  reindexDatasetJob,
} from './datasets/maintenance-jobs'
// Duplicate detection — ONE job, three scopes (mutation seam, sync manifest, 6h sweep)
export {
  type DuplicateScanJobData,
  type DuplicateScanJobStats,
  duplicateScanJob,
} from './dedup/duplicate-scan-job'
// Documents (money MQ2 PDF render pipeline)
export {
  type RenderDocumentPdfJobData,
  renderDocumentPdfJob,
} from './documents/render-document-pdf-job'
// Email
export { createEmailEnqueuer, enqueueEmailJob } from './email/enqueue-email-job'
export { sendEmailJob } from './email/send-email-job'
export type { EmailPayloadByType, EmailType, SendEmailJobData } from './email/types'
export { enrichCompanyJob } from './enrichment/enrich-company-job'
// Data export job
export { type ExportRecordsJobData, exportRecordsJob } from './export/export-records-job'
// Data print job (PDF export — plans/printing/01-unified-print.md §D)
export {
  MAX_PRINT_RECORDS_LIST,
  type PrintRecordsJobData,
  printRecordsJob,
} from './export/print-records-job'
// Flows
export {
  createDocumentProcessingFlow,
  DocumentFlowJobs,
  type FinalizeDocumentJobData,
  type FlowEmbeddingGenerationJobData,
} from './flows'
// Data import jobs
export { type ExecutePlanJobProps, executePlanJob } from './import/execute-plan-job'
export { type GeneratePlanJobProps, generatePlanJob } from './import/generate-plan-job'
export { type ResolveValuesJobProps, resolveValuesJob } from './import/resolve-values-job'
// Maintenance
export {
  type AgentDraftCleanupStats,
  agentDraftCleanupJob,
} from './maintenance/agent-draft-cleanup-job'
export { orphanedAppBundleCleanupJob } from './maintenance/app-bundle-cleanup-job'
export {
  type AppStorageSweepStats,
  appStorageSweepJob,
} from './maintenance/app-storage-sweep-job'
// The bank feed's nightly sweep (HANDOFF slot 3A): the Stripe billing reaper plus
// the stored coverage floor. Both fail silently if nobody runs them.
export {
  type BankFeedMaintenanceStats,
  bankFeedMaintenanceJob,
} from './maintenance/bank-feed-maintenance-job'
// Money P24 vendor-bill aging daily sweep — `awaiting_receipt` -> `exception`
export { companyEnrichmentSweepJob } from './maintenance/company-enrichment-sweep-job'
// Per-request provider deletion / deauthorize teardown
// (plans/channels/meta-data-deletion-callback.md §4.4). On-demand: enqueued by the
// Meta signed_request routes and the Shopify compliance webhook, never scheduled.
export {
  DATA_DELETION_JOB_NAME,
  type DataDeletionJobData,
  dataDeletionJob,
  enqueueDataDeletionJob,
} from './maintenance/data-deletion-job'
export {
  dataMigrationsJob,
  enqueueDataMigrationsRun,
} from './maintenance/data-migrations-job'
export { type DemoCleanupStats, demoCleanupJob } from './maintenance/demo-cleanup-job'
export { type DemoSeedJobData, demoSeedJob } from './maintenance/demo-seed-job'
// Dispatch worker-facing daily schedule digest sweep (plan 19 §4.9, opt-in)
export { dispatchDigestJob } from './maintenance/dispatch-digest-job'
export {
  type CleanupStats,
  expiredTrialAccountCleanupJob,
  type OrganizationToDelete,
} from './maintenance/expired-trial-account-cleanup-job'
// The three scheduled file-lifecycle sweeps (plan 7c moved them out of
// `@auxx/lib/files`, which now exports only the measurement).
export {
  deletedFileCleanupJob,
  type FileCleanupJobData,
  type FileCleanupJobResult,
  orphanedFileCleanupJob,
  storageQuotaCheckJob,
} from './maintenance/file-cleanup-jobs'
export { generateThumbnailJob, generateThumbnailSchema } from './maintenance/generate-thumbnail-job'
export {
  type GettingStartedStats,
  sendGettingStartedEmailsJob,
} from './maintenance/getting-started-job'
export { interactionResolutionSweepJob } from './maintenance/interaction-resolution-sweep-job'
// Money MI2 invoice-draft daily sweep
export { invoiceDraftsJob } from './maintenance/invoice-drafts-job'
// Mail counts reconcile (on-demand, jobId-deduped)
export {
  type MailCountsReconcileJobData,
  mailCountsReconcileJob,
} from './maintenance/mail-counts-reconcile-job'
// Weekly mail-suggestion mining (plans/mail-filter/03-suggestions-plan.md §5.1)
export {
  MAIL_SUGGESTIONS_JOB_NAME,
  type MailSuggestionsJobData,
  type MailSuggestionsJobStats,
  mailSuggestionsJob,
} from './maintenance/mail-suggestions-job'
// Daily unsubscribe-ignored sweep (plan §6.4)
export { mailUnsubscribeSweepJob } from './maintenance/mail-unsubscribe-sweep-job'
export {
  cleanupExpiredMediaAssetsJob,
  getMediaAssetCleanupStats,
} from './maintenance/media-asset-cleanup-job'
export { type MidTrialStats, sendMidTrialEmailsJob } from './maintenance/mid-trial-job'
export { oauth2TokenRefreshScannerJob } from './maintenance/oauth2-token-refresh-scanner-job'
export {
  type OrgSeedJobData,
  type OrgSeedScenario,
  orgSeedJob,
} from './maintenance/org-seed-job'
export {
  enqueueOrphanedStorageObjectCleanup,
  type OrphanedStorageObjectJobData,
  orphanedStorageObjectJob,
} from './maintenance/orphaned-storage-object-job'
// Outlook Graph subscription health sweep (webhook-push-migration plan §3.2/Phase 4.3-4.4)
export {
  type OutlookSubscriptionHealthJobData,
  outlookSubscriptionHealthJob,
} from './maintenance/outlook-subscription-health-job'
export { type QuotaResetStats, quotaResetJob } from './maintenance/quota-reset-job'
export {
  type ReconcileRecordIdentitiesStats,
  reconcileRecordIdentitiesJob,
} from './maintenance/reconcile-record-identities-job'
// Dispatch recurring engine daily sweep (M2c)
export { recurringVisitsJob } from './maintenance/recurring-visits-job'
export {
  enqueueReseedConnectionProviders,
  reseedConnectionProvidersJob,
} from './maintenance/reseed-connection-providers-job'
// Client-notifications sequence enrollment hourly sweep (plan 19 §4.3, decision #13)
export { sequenceEnrollmentSweepJob } from './maintenance/sequence-enrollment-sweep-job'
export {
  type StalePendingMessageSweeperStats,
  stalePendingMessageSweeperJob,
} from './maintenance/stale-pending-message-sweeper-job'
export {
  enqueueStorageCleanupJob,
  type StorageCleanupJobData,
  storageCleanupJob,
} from './maintenance/storage-cleanup-job'
export { getThumbnailCleanupStats, thumbnailCleanupJob } from './maintenance/thumbnail-cleanup-job'
export {
  sendTrialConversionEmailsJob,
  type TrialConversionStats,
} from './maintenance/trial-conversion-job'
export { vendorBillAgingJob } from './maintenance/vendor-bill-aging-job'
export {
  type WebhookRenewalJobData,
  webhookRenewalJob,
} from './maintenance/webhook-renewal-job'
export {
  type WebhookRenewalScannerJobData,
  webhookRenewalScannerJob,
} from './maintenance/webhook-renewal-scanner-job'
// MCP
export {
  type McpToolsResyncJobData,
  mcpToolsResyncJob,
} from './mcp/mcp-tools-resync-job'
// Messages
export {
  enqueueGooglePushSync,
  GOOGLE_PUSH_DEBOUNCE_WINDOW_MS,
  type GooglePushSyncJobData,
  googlePushSyncJob,
} from './messages/google-push-sync-job'
export {
  MONITOR_RECHECK_DELAY_MS,
  type MonitorMessageSyncJobData,
  monitorMessageSyncJob,
} from './messages/monitor-message-sync-job'
export {
  enqueueOutlookPushSync,
  OUTLOOK_PUSH_DEBOUNCE_WINDOW_MS,
  type OutlookPushSyncJobData,
  outlookPushSyncJob,
} from './messages/outlook-push-sync-job'
export {
  MONITOR_INITIAL_DELAY_MS,
  type StartMessageSyncJobData,
  startMessageSyncJob,
} from './messages/sync-all-messages-job'
export {
  type SyncSingleChannelMessagesJobData,
  syncSingleChannelMessagesJob,
} from './messages/sync-single-channel-messages-job'
export {
  enqueueThreadProviderStatusSync,
  type ThreadProviderStatusSyncJobData,
  threadProviderStatusSyncJob,
} from './messages/thread-provider-status-sync-job'
// Money (QuickBooks invoice sync — plans/dispatch/37e-quickbooks-invoice-sync.md §3, P3)
export {
  type SyncQuickbooksInvoiceJobData,
  syncQuickbooksInvoiceJob,
} from './money/sync-quickbooks-invoice-job'
// OAuth2
export { oauth2TokenRefreshJob } from './oauth2-refresh'
// Polling
export {
  imapImportBatchJob,
  messageListFetchJob,
  messagesImportJob,
  pollingRelaunchFailedJob,
  pollingStaleCheckJob,
  pollingSyncScannerJob,
} from './polling'
// Purchasing (quote → draft purchase order intake; plans/money/tasks/38 §3.3)
export {
  enqueuePurchaseIntake,
  PURCHASE_INTAKE_DAILY_LIMIT,
  PURCHASE_INTAKE_JOB_NAME,
  type PurchaseIntakeJobData,
  purchaseIntakeJob,
} from './purchasing'
// Recording
export {
  type AIPostProcessJobData,
  aiPostProcessJob,
  enqueueGenerateVideoAssetsJob,
  GENERATE_VIDEO_ASSETS_JOB_NAME,
  type GenerateVideoAssetsJobData,
  type HandleBotTimeoutJobData,
  type HandleRecordingWebhookJobData,
  handleBotTimeoutJob,
  handleRecordingWebhookJob,
  type PollActiveBotsJobData,
  type ProcessRecordingJobData,
  pollActiveBotsJob,
  processRecordingJob,
  type ScheduleBotsJobData,
  scheduleBotsForUpcomingMeetingsJob,
  type TranscribeRecordingJobData,
  transcribeRecordingJob,
} from './recording'
// Tasks
export {
  type TaskDeadlineScannerJobData,
  taskDeadlineScannerJob,
} from './tasks/task-deadline-scanner-job'
// Job context types
export type { JobContext, JobHandler } from './types'
// Webhooks
export {
  type ProcessSingleWebhookJobData,
  processSingleWebhookJob,
} from './webhooks/process-single-webhook-job'
export { processWebhookJob, WEBHOOK_EVENTS } from './webhooks/process-webhook-job'
export { isWebhookEvent } from './webhooks/webhook-events'
// Workflow
export {
  type AppTriggerDispatchJobData,
  dispatchAppTrigger,
} from './workflow/app-trigger-dispatch-job'
export {
  type ApprovalOrphanSweeperStats,
  approvalOrphanSweeperJob,
} from './workflow/approval-orphan-sweeper-job'
export { approvalReminderJob } from './workflow/approval-reminder-job'
export { approvalTimeoutJob } from './workflow/approval-timeout-job'
export {
  executeMessageTrigger,
  type MessageTriggerJobData,
} from './workflow/message-trigger-job'
export {
  executePollingTrigger,
  type PollingTriggerJobData,
} from './workflow/polling-trigger-job'
export {
  executeResourceTrigger,
  type ResourceTriggerJobData,
} from './workflow/resource-trigger-job'
export { type ResumeWorkflowJobData, resumeWorkflowJob } from './workflow/resume-workflow-job'
export {
  executeScheduledTrigger,
  type ScheduledTriggerJobData,
} from './workflow/scheduled-trigger-job'
export {
  dispatchWebhookEndpoint,
  type WebhookEndpointDispatchJobData,
} from './workflow/webhook-endpoint-dispatch-job'
export { workflowFileCleanupJob } from './workflow/workflow-file-cleanup-job'
