// apps/web/src/components/workflow/store/webhook-test-store.ts

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { WebhookTestEvent } from '../nodes/core/webhook/types'

// Re-export for backwards compatibility
export type { WebhookTestEvent }

export interface WebhookTestListener {
  events: WebhookTestEvent[]
  isListening: boolean
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  eventSource: EventSource | null
}

interface WebhookTestStore {
  // Store listeners by workflowId
  listeners: Map<string, WebhookTestListener>

  // Get listener state for a workflow
  getListener: (workflowId: string) => WebhookTestListener | undefined

  // Start listening for webhook events
  startListening: (workflowId: string) => void

  // Stop listening for webhook events
  stopListening: (workflowId: string) => void

  // Add event to a workflow's event list
  addEvent: (workflowId: string, event: WebhookTestEvent) => void

  // Clear events for a workflow
  clearEvents: (workflowId: string) => void

  // Update connection status
  updateConnectionStatus: (
    workflowId: string,
    status: 'disconnected' | 'connecting' | 'connected'
  ) => void

  // Clean up all listeners
  cleanupAll: () => void
}

export const useWebhookTestStore = create<WebhookTestStore>()(
  subscribeWithSelector((set, get) => ({
    listeners: new Map(),

    getListener: (workflowId: string) => {
      return get().listeners.get(workflowId)
    },

    startListening: (workflowId: string) => {
      const { listeners } = get()
      const existingListener = listeners.get(workflowId)

      // If already listening, do nothing
      if (existingListener?.eventSource) return

      // Create event source
      const eventSource = new EventSource(`/api/workflows/${workflowId}/webhook/events`)

      // Initialize or update listener state
      const listener: WebhookTestListener = {
        events: existingListener?.events || [],
        isListening: true,
        connectionStatus: 'connecting',
        eventSource,
      }

      // Update state
      const newListeners = new Map(listeners)
      newListeners.set(workflowId, listener)
      set({ listeners: newListeners })

      // Set up event handlers
      eventSource.onopen = () => {
        get().updateConnectionStatus(workflowId, 'connected')
      }

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.status === 'connected') return

          get().addEvent(workflowId, {
            ...data,
            id: data.id || Date.now().toString(),
          })
        } catch (error) {
          console.error('Error parsing webhook event:', error)
        }
      }

      eventSource.onerror = () => {
        get().stopListening(workflowId)
      }
    },

    stopListening: (workflowId: string) => {
      const { listeners } = get()
      const listener = listeners.get(workflowId)

      if (listener?.eventSource) {
        listener.eventSource.close()
      }

      const newListeners = new Map(listeners)
      newListeners.set(workflowId, {
        events: listener?.events || [],
        isListening: false,
        connectionStatus: 'disconnected',
        eventSource: null,
      })

      set({ listeners: newListeners })
    },

    addEvent: (workflowId: string, event: WebhookTestEvent) => {
      const { listeners } = get()
      const listener = listeners.get(workflowId)

      if (!listener) return

      const newListeners = new Map(listeners)
      newListeners.set(workflowId, {
        ...listener,
        events: [event, ...listener.events].slice(0, 50), // Keep last 50 events
      })

      set({ listeners: newListeners })
    },

    clearEvents: (workflowId: string) => {
      const { listeners } = get()
      const listener = listeners.get(workflowId)

      if (!listener) return

      const newListeners = new Map(listeners)
      newListeners.set(workflowId, {
        ...listener,
        events: [],
      })

      set({ listeners: newListeners })
    },

    updateConnectionStatus: (
      workflowId: string,
      status: 'disconnected' | 'connecting' | 'connected'
    ) => {
      const { listeners } = get()
      const listener = listeners.get(workflowId)

      if (!listener) return

      const newListeners = new Map(listeners)
      newListeners.set(workflowId, {
        ...listener,
        connectionStatus: status,
      })

      set({ listeners: newListeners })
    },

    cleanupAll: () => {
      const { listeners } = get()

      // Close all event sources
      listeners.forEach((listener) => {
        if (listener.eventSource) {
          listener.eventSource.close()
        }
      })

      set({ listeners: new Map() })
    },
  }))
)
