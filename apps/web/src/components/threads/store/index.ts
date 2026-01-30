// apps/web/src/components/threads/store/index.ts

export {
  useThreadStore,
  getThreadStoreState,
  type ThreadMeta,
  type ThreadStatus,
  type IntegrationProvider,
  type ThreadSort,
  type ContextPagination,
  type ThreadFilter,
} from './thread-store'

export {
  createContextKey,
  createThreadSelector,
  createInboxThreadsSelector,
  createAssignedThreadsSelector,
  createUnreadThreadsSelector,
  sortThreads,
  filterThreadsFromMap,
  getThreadIdsFromSelector,
} from './thread-selectors'

export {
  useMessageStore,
  getMessageStoreState,
  type MessageMeta,
  type SendStatus,
  type MessageType,
  type AttachmentMeta,
} from './message-store'

export { useMessageListStore, getMessageListStoreState } from './message-list-store'

export {
  useParticipantStore,
  getParticipantStoreState,
  type ParticipantMeta,
  type ParticipantIdentifierType,
} from './participant-store'

export {
  useThreadSelectionStore,
  useActiveThreadId,
  useSelectedThreadIds,
  useViewMode,
  useIsEditMode,
  useIsMultiSelectMode,
  useIsThreadSelected,
  useIsThreadActive,
  useSelectionCount,
  useHasSelection,
  useHasMultipleSelected,
  useFirstSelectedThreadId,
  getThreadSelectionState,
  type ViewMode,
} from './thread-selection-store'
