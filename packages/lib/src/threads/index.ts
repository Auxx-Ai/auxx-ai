// Re-export ActorId from canonical location for convenience
export type { ActorId } from '@auxx/types/actor'
export type { MutationResult, ThreadUpdates } from './thread-mutation.service'
export { ThreadMutationService } from './thread-mutation.service'
export { ThreadQueryService } from './thread-query.service'

export type {
  FullCountsResponse,
  IntegrationProvider,
  ListThreadIdsInput,
  PaginatedIdsResult,
  ThreadDetail,
  ThreadFilter,
  ThreadMeta,
  ThreadSortDescriptor,
  ThreadSortField,
  ThreadStatus,
  UserUnreadCounts,
} from './types'
export { UnreadService } from './unread-service'
