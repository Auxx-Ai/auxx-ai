// packages/lib/src/providers/google/messages/index.ts
export { createEmailMessage } from './create-message'
export { sendGmailMessage } from './send-message'
export { syncGmailMessages } from './sync-messages'
export { getMessagesBatch } from './batch-fetch'
export { parseGmailMessage, convertMessagesToMessageData } from './parse-message'

export type { CreateEmailMessageInput } from './create-message'
export type { SendGmailMessageInput, SendGmailMessageOutput } from './send-message'
export type { SyncGmailMessagesInput, SyncGmailMessagesOutput } from './sync-messages'
export type { GetMessagesBatchInput } from './batch-fetch'
