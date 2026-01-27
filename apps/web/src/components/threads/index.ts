// apps/web/src/components/threads/index.ts

// Stores
export {
  useThreadStore,
  getThreadStoreState,
  useThreadListStore,
  getThreadListStoreState,
  createListKey,
  useMessageStore,
  getMessageStoreState,
  useMessageListStore,
  getMessageListStoreState,
  useParticipantStore,
  getParticipantStoreState,
  useThreadReadStatusStore,
  getThreadReadStatusStoreState,
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
  type ThreadMeta,
  type ThreadStatus,
  type IntegrationProvider,
  type ActorId,
  type ThreadTagSummary,
  type MessageMeta,
  type DraftMode,
  type ParticipantSummary,
  type ParticipantMeta,
  type ParticipantIdentifierType,
} from './store'

// Hooks
export {
  useThread,
  useIsThreadLoading,
  useIsThreadNotFound,
  useThreadList,
  useMessage,
  useMessages,
  useParticipant,
  useParticipants,
  useParticipantsArray,
  useThreadReadStatus,
  useThreadSelection,
  useThreadKeyboardNav,
  useSelectionReset,
  useInboxById,
} from './hooks'

// Context
export { KeyboardProvider, useKeyboard, useKeyboardContext } from './context'

// Providers
export { ThreadDataProvider } from './providers'

// Realtime
export {
  useThreadRealtime,
  type ThreadRealtimeEvents,
  type ThreadRealtimeEventName,
  type SessionCreatedEvent,
  type SessionClosedEvent,
  type NewChatMessageEvent,
  type NewSystemMessageEvent,
} from './realtime'
