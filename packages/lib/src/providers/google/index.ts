// packages/lib/src/providers/google/index.ts
export { GoogleProvider } from './google-provider'
export { GoogleOAuthService } from './google-oauth'

// Message operations
export { createEmailMessage } from './messages/create-message'
export { sendGmailMessage } from './messages/send-message'
export { syncGmailMessages } from './messages/sync-messages'
export { getMessagesBatch } from './messages/batch-fetch'
export { parseGmailMessage, convertMessagesToMessageData } from './messages/parse-message'

// Draft operations
export { createGmailDraft } from './drafts/create-draft'
export { updateGmailDraft } from './drafts/update-draft'
export { sendGmailDraft } from './drafts/send-draft'

// Label operations
export {
  getLabels,
  createLabel,
  updateLabel,
  deleteLabel,
  addLabel,
  removeLabel,
} from './labels'

// Thread operations
export { getThread, updateThreadStatus, moveThread } from './threads'

// Basic operations
export { archive, markAsSpam, trash, restore } from './operations'

// Webhook operations
export { setupWebhook, removeWebhook } from './webhooks'

// Shared utilities
export { executeWithThrottle, modifyWithThrottling, getThrottleContext } from './shared/utils'
export { handleGmailError, isRecoverableError } from './shared/error-handler'

// Types
export type {
  GoogleIntegration,
  GoogleIntegrationMetadata,
  GmailOperationContext,
  ParsedGmailMessage,
  GmailMessageWithPayload,
  GoogleThrottleContext,
} from './types'
