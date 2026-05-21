// packages/lib/src/chat/index.ts

export { getChatThreadMetadata, patchChatThreadMetadata } from './metadata'
export type { SendAgentChatMessageInput } from './outbound'
export { sendAgentChatMessage } from './outbound'
export type { ChatVisitorMessagePayload } from './realtime'
export {
  publishChatMessageCreated,
  publishChatMessageReceiptUpdated,
  publishChatThreadClosed,
  publishChatTyping,
} from './realtime'
export { markDelivered, markRead } from './receipts'
export type {
  InitializeChatThreadInput,
  InitializeChatThreadResult,
} from './session'
export { initializeOrResumeChatThread } from './session'
export type { ServiceContext, VisitInfo } from './types'
export { findOrCreateVisitorParticipant } from './visitor-identity'
