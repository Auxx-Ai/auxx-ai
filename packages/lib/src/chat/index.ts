// packages/lib/src/chat/index.ts

export type {
  ResolveChatAttributesInput,
  ResolveChatAttributesResult,
} from './attribute-resolution'
export { resolveChatAttributes } from './attribute-resolution'
export { getChatJwtSuccessCount, recordChatJwtSuccess } from './jwt-success-counter'
export { getChatThreadMetadata, patchChatThreadMetadata } from './metadata'
export type { SendAgentChatMessageInput } from './outbound'
export { sendAgentChatMessage } from './outbound'
export type { ChatVisitorMessagePayload } from './realtime'
export {
  publishChatMessageCreated,
  publishChatMessageReceiptUpdated,
  publishChatThreadClosed,
  publishChatTyping,
  publishVisitorThreadCreated,
} from './realtime'
export { markDelivered, markRead } from './receipts'
export type {
  InitializeChatThreadInput,
  InitializeChatThreadResult,
} from './session'
export { initializeOrResumeChatThread } from './session'
export type { ChatAttachment, ServiceContext, VisitInfo } from './types'
export type { ChatJwtError, VerifiedChatUserJwt } from './verify-jwt'
export { hashChatUserJwt, verifyChannelUserJwt } from './verify-jwt'
export { findOrCreateVisitorParticipant, updateVisitorClaimedIdentity } from './visitor-identity'
