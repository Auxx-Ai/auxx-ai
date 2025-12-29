// packages/sdk/src/runtime/event-broker.ts

/**
 * Event broker for runtime events in extension iframe.
 * Used internally by the platform runtime for managing surface events.
 */
export class EventBroker<T = void> {
  private listeners = new Set<(event: T) => void>()
  private onceListeners = new Set<(event: T) => void>()

  /**
   * Add a persistent listener. Returns unsubscribe function.
   * Listener will be called for all future events until unsubscribed.
   */
  addListener(callback: (event: T) => void): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  /**
   * Add a one-time listener. Returns unsubscribe function.
   * Listener will be called only once, then automatically removed.
   */
  addOnceListener(callback: (event: T) => void): () => void {
    this.onceListeners.add(callback)
    return () => {
      this.onceListeners.delete(callback)
    }
  }

  /**
   * Trigger all listeners with event data.
   * Persistent listeners are called first, then one-time listeners.
   * One-time listeners are automatically removed after being called.
   */
  trigger(event: T): void {
    // Call persistent listeners
    this.listeners.forEach((callback) => {
      try {
        callback(event)
      } catch (error) {
        console.error('[Runtime EventBroker] Listener error:', error)
      }
    })

    // Call and remove one-time listeners
    this.onceListeners.forEach((callback) => {
      try {
        callback(event)
      } catch (error) {
        console.error('[Runtime EventBroker] Once-listener error:', error)
      }
    })
    this.onceListeners.clear()
  }

  /**
   * Check if there are any listeners (persistent or one-time).
   */
  isIdle(): boolean {
    return this.listeners.size === 0 && this.onceListeners.size === 0
  }

  /**
   * Remove all listeners.
   */
  clear(): void {
    this.listeners.clear()
    this.onceListeners.clear()
  }
}
