export enum Queues {
  defaultQueue = 'default',
  // evaluationsQueue = 'evaluations',
  /** Agent-Simulation eval runs (and their watchdog), bounded apart from the AI pool. */
  evalRunQueue = 'eval-run',
  eventHandlersQueue = 'eventHandlers',
  eventsQueue = 'events',
  // liveEvaluationsQueue = 'liveEvaluations',
  maintenanceQueue = 'maintenance',
  webhooksQueue = 'webhooks',
  // documentsQueue = 'documentsQueue',
  // documentSuggestionsQueue = 'documentSuggestionsQueue',
  // Quote/invoice PDF rendering queue (money MQ2 build spec §C.3)
  documentPdfQueue = 'document-pdf',
  embeddingQueue = 'embedding',
  uploadQueue = 'upload',
  messageSyncQueue = 'messageSync',
  messageProcessingQueue = 'messageProcessing', // NEW
  workflowDelayQueue = 'workflowDelay',
  scheduledTriggerQueue = 'scheduled-trigger-queue',
  // Dataset management queues
  datasetQueue = 'dataset-queue',
  documentProcessingQueue = 'document-processing-queue',
  datasetMaintenanceQueue = 'dataset-maintenance-queue',
  // Thumbnail generation queue
  thumbnailQueue = 'thumbnail',
  // OAuth2 token refresh queue
  oauth2RefreshQueue = 'oauth2-refresh',
  // Data import queue
  dataImportQueue = 'data-import',
  // Data export queue (background CSV record export)
  dataExportQueue = 'data-export',
  // Polling sync queue
  pollingSyncQueue = 'polling-sync',
  // Calendar sync queue
  calendarSyncQueue = 'calendar-sync',
  // Email delivery queue
  emailQueue = 'email',
  // App trigger dispatch queue
  appTriggerQueue = 'app-trigger',
  // App polling trigger queue (scheduled poll → dispatch)
  appPollingTriggerQueue = 'app-polling-trigger-queue',
  // AI agent session processing queue (Kopilot, Builder)
  aiAgentQueue = 'ai-agent',
  // Dedicated chat-agent queue — visitor chat turns run here, isolated from
  // the shared ai-agent pool so a burst elsewhere can't delay a live reply.
  chatAgentQueue = 'chat-agent',
  // Recording bot queue (schedule, webhook handling, polling, timeouts)
  recordingBotQueue = 'recording-bot',
  // Recording media processing queue (download + S3 upload)
  recordingProcessingQueue = 'recording-processing',
  // AI autofill queue (per-field AI generation jobs)
  aiAutofillQueue = 'ai-autofill',
  // KB article → managed-dataset sync queue
  kbSyncQueue = 'kb-sync',
  // Knowledge Source orchestration (crawl/ingest re-sync) queue
  knowledgeSourceQueue = 'knowledge-source',
  // Data Connector orchestration (structured-record sync) queue
  dataConnectorQueue = 'data-connector',
  // Learned-KB extraction (AI memory from resolved threads) queue
  learnedExtractionQueue = 'learned-extraction',
  // QuickBooks invoice sync queue (plans/dispatch/37e-quickbooks-invoice-sync.md §3, P3)
  quickbooksInvoiceSyncQueue = 'quickbooks-invoice-sync',
  // Purchase-order intake: read a vendor's quote into a draft purchase order
  // (plans/money/tasks/38-purchase-order-from-a-document.md §3.3). Its own queue
  // because one job is a multimodal LLM read of a whole document — 10 to 40
  // seconds — and a burst of uploads must not sit behind, or in front of, the
  // shared AI pool.
  purchaseIntakeQueue = 'purchase-intake',
  // Inbound-mail AI categorisation (mail-classification plan §4). Its OWN queue:
  // the call cannot run in the `message:received` gate (2s timeout, shared
  // `eventsQueue`) and must not hold `eventHandlersQueue` slots for seconds.
  mailClassificationQueue = 'mail-classification',
  // Company website enrichment. Its OWN queue: one job is an outbound fetch of a
  // third-party homepage plus a logo (8s + 5s worst case), and a bulk import can enqueue
  // hundreds at once. Inline on the events worker, a 315-row import held one slot for the
  // better part of an hour. `maintenanceQueue` is not an alternative — it runs at
  // concurrency 1 shared with ~30 sweep jobs.
  enrichmentQueue = 'enrichment',
}
