// Re-export ActorId from canonical location for convenience
export type { ActorId } from '@auxx/types/actor'
export {
  clearPrimaryEntity,
  getWorkItemsForThread,
  type LinkEntityToThreadParams,
  type LinkRole,
  linkEntityToThread,
  type ThreadWorkItem,
  unlinkEntity,
} from './links.service'
export type { MutationResult, ThreadUpdates } from './thread-mutation.service'
export { ThreadMutationService } from './thread-mutation.service'
export { ThreadQueryService } from './thread-query.service'

export type {
  ChannelProvider,
  FullCountsResponse,
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
