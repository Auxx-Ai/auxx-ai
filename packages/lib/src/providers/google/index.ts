// packages/lib/src/providers/google/index.ts

// Draft operations
export { createGmailDraft } from './drafts/create-draft'
export { sendGmailDraft } from './drafts/send-draft'
export { updateGmailDraft } from './drafts/update-draft'
export { GoogleOAuthService } from './google-oauth'
export { GoogleProvider } from './google-provider'
// Label operations
export {
  addLabel,
  createLabel,
  deleteLabel,
  getLabels,
  removeLabel,
  updateLabel,
} from './labels'
export { getMessagesBatch } from './messages/batch-fetch'
// Message operations
export { createEmailMessage } from './messages/create-message'
export { convertMessagesToMessageData, parseGmailMessage } from './messages/parse-message'
export { sendGmailMessage } from './messages/send-message'
export { syncGmailMessages } from './messages/sync-messages'
// Basic operations
export { archive, markAsSpam, restore, trash } from './operations'
export { handleGmailError, isRecoverableError } from './shared/error-handler'
// Shared utilities
export { executeWithThrottle, getThrottleContext, modifyWithThrottling } from './shared/utils'
// Thread operations
export { getThread, moveThread, updateThreadStatus } from './threads'
// Types
export type {
  GmailMessageWithPayload,
  GmailOperationContext,
  GoogleIntegration,
  GoogleIntegrationMetadata,
  GoogleThrottleContext,
  ParsedGmailMessage,
} from './types'
// Webhook operations
export { removeWebhook, setupWebhook } from './webhooks'
