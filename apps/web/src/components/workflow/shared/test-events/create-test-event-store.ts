// apps/web/src/components/workflow/shared/test-events/create-test-event-store.ts

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { BaseTestEvent, TestEventStore } from './types'

/**
 * Creates a Zustand store for managing SSE-based test event listeners.
 * @param buildSseUrl - Function that maps a key to an SSE endpoint URL
 * @param maxEvents - Maximum events to retain per listener (default 50)
 */
export function createTestEventStore<T extends BaseTestEvent>(
  buildSseUrl: (key: string) => string,
  maxEvents = 50
) {
  return create<TestEventStore<T>>()(
    subscribeWithSelector((set, get) => ({
      listeners: new Map(),

      getListener: (key) => get().listeners.get(key),

      startListening: (key) => {
        const { listeners } = get()
        const existing = listeners.get(key)
        if (existing?.eventSource) return

        const eventSource = new EventSource(buildSseUrl(key))
        const listener = {
          events: existing?.events || [],
          isListening: true,
          connectionStatus: 'connecting' as const,
          eventSource,
        }

        const newListeners = new Map(listeners)
        newListeners.set(key, listener)
        set({ listeners: newListeners })

        eventSource.onopen = () => {
          get().updateConnectionStatus(key, 'connected')
        }

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            if (data.status === 'connected') return
            get().addEvent(key, { ...data, id: data.id || Date.now().toString() })
          } catch (error) {
            console.error('Error parsing test event:', error)
          }
        }

        eventSource.onerror = () => {
          get().stopListening(key)
        }
      },

      stopListening: (key) => {
        const { listeners } = get()
        const listener = listeners.get(key)
        if (listener?.eventSource) listener.eventSource.close()

        const newListeners = new Map(listeners)
        newListeners.set(key, {
          events: listener?.events || [],
          isListening: false,
          connectionStatus: 'disconnected',
          eventSource: null,
        })
        set({ listeners: newListeners })
      },

      addEvent: (key, event) => {
        const { listeners } = get()
        const listener = listeners.get(key)
        if (!listener) return

        const newListeners = new Map(listeners)
        newListeners.set(key, {
          ...listener,
          events: [event, ...listener.events].slice(0, maxEvents),
        })
        set({ listeners: newListeners })
      },

      clearEvents: (key) => {
        const { listeners } = get()
        const listener = listeners.get(key)
        if (!listener) return

        const newListeners = new Map(listeners)
        newListeners.set(key, { ...listener, events: [] })
        set({ listeners: newListeners })
      },

      updateConnectionStatus: (key, status) => {
        const { listeners } = get()
        const listener = listeners.get(key)
        if (!listener) return

        const newListeners = new Map(listeners)
        newListeners.set(key, { ...listener, connectionStatus: status })
        set({ listeners: newListeners })
      },

      cleanupAll: () => {
        const { listeners } = get()
        listeners.forEach((listener) => {
          if (listener.eventSource) listener.eventSource.close()
        })
        set({ listeners: new Map() })
      },
    }))
  )
}
