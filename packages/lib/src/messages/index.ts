// packages/lib/src/messages/index.ts

export { MessageSenderService } from './message-sender.service'
export { MessageComposerService } from './message-composer.service'
export { ThreadManagerService } from './thread-manager.service'
export { MessageReconcilerService } from './message-reconciler.service'
export { MessageSyncService } from './message-sync-service'
export { MessageQueryService } from './message-query.service'
export { SyncMessages } from './sync-messages'

// Export types
export * from './types/message-sending.types'
export type {
  MessageMeta,
  DraftMode,
  ListMessageIdsOptions,
  ListMessagesByThreadResult,
} from './types/message-query.types'
