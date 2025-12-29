// packages/sdk/src/runtime/host.ts

import { MessageError } from '../shared/errors.js'

/**
 * Message sent to the host platform.
 */
export interface HostMessage {
  type: string
  data: any
  source: 'auxx-extension'
  appId: string
  appInstallationId: string
  requestId?: string
}

/**
 * Message received from the host platform.dfe
 */
export interface HostRequest {
  type: string
  data: any
  source: 'auxx-platform'
  appId: string
  requestId?: string
}

/**
 * Host communication manager.
 * Handles bidirectional postMessage communication with the parent platform window.
 */
class HostManager {
  private webAppOrigin: string = ''
  private appId: string = ''
  private appInstallationId: string = ''
  private requestHandlers = new Map<string, (data: any) => any>()
  private pendingRequests = new Map<
    string,
    { resolve: (value: any) => void; reject: (error: any) => void }
  >()
  private requestIdCounter = 0

  /**
   * Initialize host communication with environment.
   */
  initialize(env: { webAppOrigin: string; appId: string; appInstallationId: string }): void {
    this.webAppOrigin = env.webAppOrigin
    this.appId = env.appId
    this.appInstallationId = env.appInstallationId

    // Set up message listener
    window.addEventListener('message', this.handleMessage.bind(this))

    console.log('[Host] Initialized with origin:', this.webAppOrigin)
  }

  /**
   * Send a message to the host platform.
   */
  sendMessage(type: string, data: any, requestId?: string): void {
    if (!this.webAppOrigin) {
      throw new MessageError('Host not initialized - webAppOrigin not set')
    }

    const message: HostMessage = {
      type,
      data,
      source: 'auxx-extension',
      appId: this.appId,
      appInstallationId: this.appInstallationId,
      ...(requestId && { requestId }),
    }

    window.parent.postMessage(message, this.webAppOrigin)
  }

  /**
   * Send a request to the host and wait for response.
   */
  async sendRequest<T = any>(type: string, data: any): Promise<T> {
    if (!this.webAppOrigin) {
      throw new MessageError('Host not initialized - webAppOrigin not set')
    }

    const requestId = `req-${++this.requestIdCounter}`

    const message: HostMessage = {
      type,
      data,
      source: 'auxx-extension',
      appId: this.appId,
      appInstallationId: this.appInstallationId,
      requestId,
    }

    return new Promise<T>((resolve, reject) => {
      // Store pending request
      this.pendingRequests.set(requestId, { resolve, reject })

      // Set timeout (30s)
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          reject(new MessageError(`Request timeout: ${type}`))
        }
      }, 30000)

      // Send message
      window.parent.postMessage(message, this.webAppOrigin)
    })
  }

  /**
   * Register a handler for incoming requests from host.
   */
  onRequest(type: string, handler: (data: any) => any): () => void {
    this.requestHandlers.set(type, handler)
    return () => {
      this.requestHandlers.delete(type)
    }
  }

  /**
   * Alias for onRequest
   */
  listenForRequest(type: string, handler: (data: any) => any): () => void {
    return this.onRequest(type, handler)
  }

  /**
   * Handle incoming messages from host.
   */
  private handleMessage(event: MessageEvent): void {
    // Validate origin (cross-origin security)
    if (this.webAppOrigin && event.origin !== this.webAppOrigin) {
      console.warn('[Host] Ignoring message from invalid origin:', event.origin)
      return
    }

    // Validate message format
    if (!event.data || event.data.source !== 'auxx-platform' || event.data.appId !== this.appId) {
      return
    }

    const request: HostRequest = event.data

    // Handle response to our request
    if (request.type === 'response' && request.requestId) {
      const pending = this.pendingRequests.get(request.requestId)
      if (pending) {
        this.pendingRequests.delete(request.requestId)
        if (request.data.error) {
          pending.reject(new MessageError(request.data.error))
        } else {
          pending.resolve(request.data.result)
        }
      }
      return
    }

    // Handle request from platform
    const handler = this.requestHandlers.get(request.type)
    if (handler) {
      try {
        const result = handler(request.data)
        if (result instanceof Promise) {
          result
            .then((res) => {
              if (request.requestId) {
                this.sendMessage('response', {
                  result: res,
                }, request.requestId)
              }
            })
            .catch((error) => {
              if (request.requestId) {
                this.sendMessage('response', {
                  error: error.message || 'Unknown error',
                }, request.requestId)
              }
            })
        } else if (request.requestId) {
          this.sendMessage('response', {
            result,
          }, request.requestId)
        }
      } catch (error: any) {
        console.error('[Host] Handler error:', error)
        if (request.requestId) {
          this.sendMessage('response', {
            error: error.message || 'Unknown error',
          }, request.requestId)
        }
      }
    }
  }

  /**
   * Clear all handlers and pending requests.
   */
  clear(): void {
    this.requestHandlers.clear()
    this.pendingRequests.forEach(({ reject }) => {
      reject(new MessageError('Host cleared'))
    })
    this.pendingRequests.clear()
  }
}

/**
 * Global Host instance available in platform runtime.
 */
export const Host = new HostManager()
