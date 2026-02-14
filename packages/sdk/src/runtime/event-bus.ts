// packages/sdk/src/runtime/event-bus.ts

/**
 * Global event bus for managing Tag event listeners.
 * Maps (eventName, instanceId) → handler function
 */
class EventBus {
  private listeners = new Map<string, Function>()

  /**
   * Generate key for event listener
   */
  private getKey(eventName: string, instanceId: number): string {
    return `${eventName}:${instanceId}`
  }

  /**
   * Register an event listener for a Tag instance
   */
  setTagEventListener(eventName: string, instanceId: number, handler: Function): void {
    const key = this.getKey(eventName, instanceId)
    this.listeners.set(key, handler)
  }

  /**
   * Remove an event listener for a Tag instance
   */
  clearTagEventListener(eventName: string, instanceId: number): void {
    const key = this.getKey(eventName, instanceId)
    this.listeners.delete(key)
  }

  /**
   * Call an event listener for a Tag instance
   */
  async callTagEventListener(eventName: string, instanceId: number, args: any[]): Promise<any> {
    const key = this.getKey(eventName, instanceId)
    const handler = this.listeners.get(key)

    if (!handler) {
      console.warn(`[EventBus] No listener for ${eventName} on instance ${instanceId}`)
      return null
    }

    return handler(...args)
  }

  /**
   * Check if listener exists
   */
  hasTagEventListener(eventName: string, instanceId: number): boolean {
    const key = this.getKey(eventName, instanceId)
    return this.listeners.has(key)
  }
}

/** Global EventBus instance */
export const eventBus = new EventBus()
