// packages/lib/src/providers/google/messages/index.ts

export type { GetMessagesBatchInput } from './batch-fetch'
export { getMessagesBatch } from './batch-fetch'
export type { CreateEmailMessageInput } from './create-message'
export { createEmailMessage } from './create-message'
export { convertMessagesToMessageData, parseGmailMessage } from './parse-message'
export type { SendGmailMessageInput, SendGmailMessageOutput } from './send-message'
export { sendGmailMessage } from './send-message'
export type { SyncGmailMessagesInput, SyncGmailMessagesOutput } from './sync-messages'
export { syncGmailMessages } from './sync-messages'
