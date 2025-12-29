// apps/web/src/components/workflow/store/event-bus.ts

import type { StoreEvent } from './types'

type EventHandler<T = any> = (data: T) => void
type UnsubscribeFn = () => void

/**
 * Event bus for inter-store communication
 * Enables decoupled communication between different stores
 */
class StoreEventBus {
  private listeners = new Map<string, Set<EventHandler>>()
  private eventHistory: StoreEvent[] = []
  private maxHistorySize = 100

  /**
   * Emit an event to all registered listeners
   */
  emit<T extends StoreEvent>(event: T): void {
    const handlers = this.listeners.get(event.type)

    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(event.data)
        } catch (error) {
          console.error(`Error in event handler for ${event.type}:`, error)
        }
      })
    }

    // Keep event history for debugging
    this.eventHistory.push(event)
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift()
    }
  }

  /**
   * Subscribe to an event type
   */
  on<T extends StoreEvent['type']>(
    eventType: T,
    handler: EventHandler<Extract<StoreEvent, { type: T }>['data']>
  ): UnsubscribeFn {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }

    this.listeners.get(eventType)!.add(handler)

    // Return unsubscribe function
    return () => {
      const handlers = this.listeners.get(eventType)
      if (handlers) {
        handlers.delete(handler)
        if (handlers.size === 0) {
          this.listeners.delete(eventType)
        }
      }
    }
  }

  /**
   * Subscribe to an event type for a single emission
   */
  once<T extends StoreEvent['type']>(
    eventType: T,
    handler: EventHandler<Extract<StoreEvent, { type: T }>['data']>
  ): UnsubscribeFn {
    const wrappedHandler: EventHandler = (data) => {
      handler(data)
      unsubscribe()
    }

    const unsubscribe = this.on(eventType as any, wrappedHandler)
    return unsubscribe
  }

  /**
   * Remove all listeners for a specific event type
   */
  off(eventType: StoreEvent['type']): void {
    this.listeners.delete(eventType)
  }

  /**
   * Remove all listeners
   */
  clear(): void {
    this.listeners.clear()
    this.eventHistory = []
  }

  /**
   * Get event history for debugging
   */
  getEventHistory(): ReadonlyArray<StoreEvent> {
    return [...this.eventHistory]
  }

  /**
   * Get listener count for an event type
   */
  getListenerCount(eventType?: StoreEvent['type']): number {
    if (eventType) {
      return this.listeners.get(eventType)?.size || 0
    }

    let total = 0
    this.listeners.forEach((handlers) => {
      total += handlers.size
    })
    return total
  }
}

// Export singleton instance
export const storeEventBus = new StoreEventBus()

// Export for testing
export { StoreEventBus }
