export enum Queues {
  defaultQueue = 'default',
  // evaluationsQueue = 'evaluations',
  eventHandlersQueue = 'eventHandlers',
  eventsQueue = 'events',
  // liveEvaluationsQueue = 'liveEvaluations',
  maintenanceQueue = 'maintenance',
  webhooksQueue = 'webhooks',
  // documentsQueue = 'documentsQueue',
  // documentSuggestionsQueue = 'documentSuggestionsQueue',
  shopifyQueue = 'shopify',
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
  // Recording bot queue (schedule, webhook handling, polling, timeouts)
  recordingBotQueue = 'recording-bot',
  // Recording media processing queue (download + S3 upload)
  recordingProcessingQueue = 'recording-processing',
  // AI autofill queue (per-field AI generation jobs)
  aiAutofillQueue = 'ai-autofill',
  // KB article → managed-dataset sync queue
  kbSyncQueue = 'kb-sync',
}
