// packages/lib/src/messages/index.ts

export { MessageComposerService } from './message-composer.service'
export { MessageQueryService } from './message-query.service'
export { MessageReconcilerService } from './message-reconciler.service'
export { MessageSenderService } from './message-sender.service'
export { MessageSyncService } from './message-sync-service'
export { SyncMessages } from './sync-messages'
export { ThreadManagerService } from './thread-manager.service'
export type {
  ListMessageIdsOptions,
  ListMessagesByThreadResult,
  MessageMeta,
} from './types/message-query.types'
// Export types
export * from './types/message-sending.types'
