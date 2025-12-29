// apps/web/src/lib/extensions/connection-expired-emitter.ts

/**
 * Event data emitted when a connection expires during server function execution
 */
export type ConnectionExpiredEvent = {
  appId: string
  appSlug: string
  appName: string
  installationId: string
  scope: 'user' | 'organization'
  connectionType: 'oauth2-code' | 'secret'
  connectionLabel: string
  // Store pending function call for retry
  pendingCall: {
    moduleHash: string
    args: string
  }
}

type EventListener = (event: ConnectionExpiredEvent) => void

/**
 * Event emitter for handling connection expired events
 *
 * This emitter allows the server function handler to communicate with UI components
 * when a connection expires. The dialog component subscribes to these events and
 * displays the reconnection dialog when needed.
 */
class ConnectionExpiredEmitter {
  private listeners: EventListener[] = []

  /**
   * Subscribe to connection expired events
   * @param listener - Callback function to invoke when event is emitted
   * @returns Unsubscribe function
   */
  subscribe(listener: EventListener): () => void {
    this.listeners.push(listener)

    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }

  /**
   * Emit a connection expired event to all subscribers
   * @param event - The connection expired event data
   */
  emit(event: ConnectionExpiredEvent): void {
    this.listeners.forEach(listener => listener(event))
  }
}

// Export singleton instance
export const connectionExpiredEmitter = new ConnectionExpiredEmitter()
