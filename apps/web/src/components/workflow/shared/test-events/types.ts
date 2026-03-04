// apps/web/src/components/workflow/shared/test-events/types.ts

/** Base fields shared by all test event types */
export interface BaseTestEvent {
  id: string
  timestamp: string
  responseTime?: number
}

/** Connection status for SSE listeners */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

/** Listener state managed by the test event store */
export interface TestEventListener<T extends BaseTestEvent> {
  events: T[]
  isListening: boolean
  connectionStatus: ConnectionStatus
  eventSource: EventSource | null
}

/** Store interface returned by createTestEventStore */
export interface TestEventStore<T extends BaseTestEvent> {
  listeners: Map<string, TestEventListener<T>>
  getListener: (key: string) => TestEventListener<T> | undefined
  startListening: (key: string) => void
  stopListening: (key: string) => void
  addEvent: (key: string, event: T) => void
  clearEvents: (key: string) => void
  updateConnectionStatus: (key: string, status: ConnectionStatus) => void
  cleanupAll: () => void
}
