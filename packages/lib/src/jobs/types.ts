export interface EmailJobData {
  email: string
  subject: string
  body: string
  // ... other email details
}

export type WebhookJobDataProps = {
  webhookEventId: string
  organizationId: string
  integrationId: string
}

export interface SyncJobData {
  organizationId: string
  integrationId: string
  type: string // e.g., 'shopify_sync_customers', 'shopify_sync_orders'
  syncId: string // The ID from SyncManager
  // userId?: string; // Keep if needed by job handlers
}

export interface UploadJobData {
  fileId: string // ID of the file record in DB
  filePath: string // Path to the file (could be S3 key)
  userId: string // User who uploaded
  jobId?: string // Optional: Pre-generated ID if needed for tracking
  // ... other upload details
}

export interface EmbeddingProcessJobData {
  jobId: string // The DB embedding job ID
  organizationId: string
}

export interface EmbeddingDeleteJobData {
  collection: string
  documentId: string
  organizationId: string
}

export interface EmbeddingRegenerateJobData {
  articleId: string
  organizationId: string
}
