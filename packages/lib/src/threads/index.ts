export { UnreadService } from './unread-service'
export { ThreadQueryService } from './thread-query.service'
export { ThreadMutationService } from './thread-mutation.service'

export type { MutationResult, ThreadUpdates } from './thread-mutation.service'

export type {
  ListThreadsInput,
  ThreadSortDescriptor,
  ThreadSortField,
  ListThreadIdsInput,
  PaginatedIdsResult,
  ThreadMeta,
  ThreadDetail,
  ThreadStatus,
  IntegrationProvider,
  ThreadFilter,
} from './types'

// Re-export ActorId from canonical location for convenience
export type { ActorId } from '@auxx/types/actor'
