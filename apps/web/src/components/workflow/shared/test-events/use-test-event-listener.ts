// apps/web/src/components/workflow/shared/test-events/use-test-event-listener.ts

import { useCallback } from 'react'
import type { StoreApi, UseBoundStore } from 'zustand'
import type { BaseTestEvent, TestEventStore } from './types'

export function useTestEventListener<T extends BaseTestEvent>(
  useStore: UseBoundStore<StoreApi<TestEventStore<T>>>,
  key: string
) {
  const listener = useStore((state) => state.getListener(key))
  const startListeningStore = useStore((state) => state.startListening)
  const stopListeningStore = useStore((state) => state.stopListening)
  const clearEventsStore = useStore((state) => state.clearEvents)

  const startListening = useCallback(() => startListeningStore(key), [key, startListeningStore])
  const stopListening = useCallback(() => stopListeningStore(key), [key, stopListeningStore])
  const clearEvents = useCallback(() => clearEventsStore(key), [key, clearEventsStore])

  return {
    events: listener?.events || [],
    isListening: listener?.isListening || false,
    connectionStatus: listener?.connectionStatus || 'disconnected',
    startListening,
    stopListening,
    clearEvents,
  }
}
