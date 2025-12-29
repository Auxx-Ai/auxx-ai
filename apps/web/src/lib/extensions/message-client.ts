// apps/web/src/lib/extensions/message-client.ts

/**
 * MessageHandler function type.
 * Can return void, a value, or a Promise.
 */
type MessageHandler = (data: any) => any

/**
 * Queued message structure.
 */
interface QueuedMessage {
  type: string
  data: any
}

/**
 * Message sent to the extension runtime.
 */
interface PlatformMessage {
  type: string
  data: any
  source: 'auxx-platform'
  appId: string
  appInstallationId: string
  requestId?: string
}

/**
 * Message received from the extension runtime.
 */
interface ExtensionMessage {
  type: string
  data: any
  source: 'auxx-extension'
  appId: string
  requestId?: string
}

/**
 * Context passed to platform runtime via URL parameters.
 */
interface ExtensionContext {
  organizationId: string
  organizationHandle: string
  organizationName: string
  userId: string
  userName: string
  userEmail: string
  apiUrl: string
  isDevelopment: boolean
}

/**
 * Manages bidirectional communication with an extension bundle running in an iframe.
 *
 * The MessageClient:
 * - Creates an iframe loading the platform runtime
 * - Passes context via URL parameters
 * - Sends messages to the extension via postMessage
 * - Listens for messages from the extension
 * - Queues messages until the iframe is ready
 */
export class MessageClient {
  private iframe: HTMLIFrameElement | null = null
  private messageHandlers = new Map<string, Set<MessageHandler>>()
  private messageQueue: QueuedMessage[] = []
  private incomingMessageBuffer = new Map<string, any[]>()
  private isReady = false
  private sdkReady = false
  private readyPromise: Promise<void>
  private readyResolve?: () => void
  private sdkReadyPromise: Promise<void>
  private sdkReadyResolve?: () => void
  private sdkReadyReject?: (error: Error) => void
  private pendingRequests = new Map<
    string,
    { resolve: (value: any) => void; reject: (error: any) => void }
  >()
  private requestIdCounter = 0
  private apiUrl: string = ''

  constructor(
    private appId: string,
    private appInstallationId: string,
    apiUrl?: string
  ) {
    this.apiUrl = apiUrl || ''
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve
    })
    this.sdkReadyPromise = new Promise((resolve, reject) => {
      this.sdkReadyResolve = resolve
      this.sdkReadyReject = reject
    })

    // Listen for messages from extension
    window.addEventListener('message', this.handleMessage)
  }

  /**
   * Initialize the message client by creating iframe with platform runtime.
   * Per Plan 6: Uses URL params to pass context + extensionBundleUrl.
   */
  async initialize(extensionBundleUrl: string, context: ExtensionContext): Promise<void> {
    // Build iframe URL with all context as query params (Plan 6 approach)
    const iframeUrl = this.buildRuntimeUrl(extensionBundleUrl, context)

    // Create iframe
    this.iframe = document.createElement('iframe')
    this.iframe.style.display = 'none'
    this.iframe.sandbox.add('allow-scripts', 'allow-same-origin')

    // Wait for iframe to load
    await new Promise<void>((resolve, reject) => {
      if (!this.iframe) return reject(new Error('Iframe not created'))

      // CRITICAL: Attach event handlers BEFORE setting src to prevent race condition
      // If src is set first and the HTML is cached, onload can fire before handlers are attached
      this.iframe.onload = () => {
        this.isReady = true
        this.readyResolve?.()
        this.flushMessageQueue()
        resolve()
      }

      this.iframe.onerror = (error) => {
        reject(new Error('Failed to load extension runtime'))
      }

      // NOW set src (after handlers are attached)
      this.iframe.src = iframeUrl

      // Append to document
      document.body.appendChild(this.iframe)

      // Safety check: If iframe loaded synchronously (cached), trigger onload manually
      // Use setTimeout to check in next event loop tick (after any synchronous load completes)
      // This must happen AFTER appendChild so contentDocument is accessible
      setTimeout(() => {
        if (this.iframe && !this.isReady) {
          const doc = this.iframe.contentDocument || this.iframe.contentWindow?.document
          if (doc?.readyState === 'complete') {
            this.iframe.onload?.(new Event('load') as any)
          }
        }
      }, 0)
    })
  }

  /**
   * Build the platform runtime URL with context as query params.
   * Per Plan 6: Same HTML file for all extensions, context via URL params.
   */
  private buildRuntimeUrl(extensionBundleUrl: string, context: ExtensionContext): string {
    const params = new URLSearchParams({
      appId: this.appId,
      appInstallationId: this.appInstallationId,
      organizationId: context.organizationId,
      organizationHandle: context.organizationHandle,
      organizationName: context.organizationName,
      userId: context.userId,
      userName: context.userName,
      userEmail: context.userEmail,
      apiUrl: context.apiUrl,
      platform: 'web-app',
      isDevelopment: context.isDevelopment.toString(),
      extensionBundleUrl, // Platform runtime will load this dynamically
      webAppOrigin: window.location.origin, // For cross-origin validation
      version: Date.now().toString(), // For debugging/cache busting
    })

    // Get API origin from environment
    const apiOrigin = context.apiUrl || process.env.NEXT_PUBLIC_API_URL || ''

    // Cross-origin iframe URL (API domain)
    // In production, this would be https://api.auxx.ai/app-runtime/index.html
    // For now, use same origin until API is set up
    return `${apiOrigin}/app-runtime/index.html?${params.toString()}`
  }

  /**
   * Wait until message client is ready.
   */
  async waitUntilReady(timeout = 10000): Promise<void> {
    // Stage 1: Wait for iframe HTML to load
    try {
      await Promise.race([
        this.readyPromise,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Stage 1 timeout')), timeout)
        ),
      ])
    } catch (error) {
      const bundleUrl = this.iframe?.src || 'unknown'
      throw new Error(
        `MessageClient iframe load timeout (Stage 1 failed)\n` +
          `App: ${this.appId}\n` +
          `Bundle: ${bundleUrl}\n` +
          `The iframe HTML failed to load within ${timeout}ms. Check network tab for errors.`
      )
    }

    // Stage 2: Wait for SDK to signal it's ready
    if (this.sdkReady) {
      return // Already ready
    }

    try {
      await Promise.race([
        this.sdkReadyPromise,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Stage 2 timeout')), timeout)
        ),
      ])
    } catch (error) {
      const bundleUrl = this.iframe?.src || 'unknown'
      throw new Error(
        `MessageClient SDK initialization timeout (Stage 2 failed)\n` +
          `App: ${this.appId}\n` +
          `Bundle: ${bundleUrl}\n` +
          `The SDK did not send 'sdk-ready' signal within ${timeout}ms.\n` +
          `Possible causes:\n` +
          `- Extension bundle failed to load (check network tab)\n` +
          `- Extension bundle has syntax/runtime errors (check console)\n` +
          `- Bundle took too long to download\n` +
          `- Platform runtime script failed to execute`
      )
    }
  }

  /**
   * Send a message to the extension.
   */
  sendMessage(type: string, data: any = {}, requestId?: string): void {
    const message = {
      type,
      data,
      source: 'auxx-platform',
      appId: this.appId,
      appInstallationId: this.appInstallationId,
      ...(requestId && { requestId }),
    }

    if (!this.isReady || !this.iframe?.contentWindow) {
      // Queue message until iframe is ready
      this.messageQueue.push({ type, data })
      return
    }

    // Get target origin from iframe src (API domain)
    const targetOrigin = this.iframe.src ? new URL(this.iframe.src).origin : '*'
    this.iframe.contentWindow.postMessage(message, targetOrigin)
  }

  /**
   * Send a request to the extension and wait for response.
   */
  async sendRequest<T = any>(
    type: string,
    data: any = {},
    options?: { timeout?: number }
  ): Promise<T> {
    // Always wait for ready state first
    await this.waitUntilReady(options?.timeout)

    if (!this.iframe?.contentWindow) {
      throw new Error('MessageClient iframe destroyed')
    }

    const requestId = `req-${++this.requestIdCounter}`

    const message = {
      type,
      data,
      source: 'auxx-platform',
      appId: this.appId,
      appInstallationId: this.appInstallationId,
      requestId,
    }

    return new Promise<T>((resolve, reject) => {
      const timeoutMs = options?.timeout || 30000
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          reject(new Error(`Request ${type} timed out after ${timeoutMs}ms`))
        }
      }, timeoutMs)

      // Store pending request with timeout cleanup
      this.pendingRequests.set(requestId, {
        resolve: (value: T) => {
          clearTimeout(timeoutId)
          resolve(value)
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId)
          reject(error)
        },
      })

      // Get target origin from iframe src (API domain)
      const targetOrigin = this.iframe!.src ? new URL(this.iframe!.src).origin : '*'
      if (this.iframe && this.iframe.contentWindow)
        this.iframe.contentWindow.postMessage(message, targetOrigin)
    })
  }

  /**
   * Listen for a specific message type from the extension.
   * Returns unsubscribe function.
   */
  listenForRequest(type: string, handler: MessageHandler): () => void {
    let handlers = this.messageHandlers.get(type)

    if (!handlers) {
      handlers = new Set()
      this.messageHandlers.set(type, handlers)
    }

    handlers.add(handler)

    // Replay any buffered messages for this type
    const buffered = this.incomingMessageBuffer.get(type)
    if (buffered && buffered.length > 0) {
      buffered.forEach((data) => {
        try {
          handler(data)
        } catch (error) {}
      })
      this.incomingMessageBuffer.delete(type)
    }

    // Return unsubscribe function
    return () => {
      handlers?.delete(handler)
      if (handlers?.size === 0) {
        this.messageHandlers.delete(type)
      }
    }
  }

  /**
   * Handle incoming messages from extension.
   */
  private handleMessage = async (event: MessageEvent) => {
    // Accept messages from either same-origin or API origin
    const allowedOrigins = [window.location.origin]
    if (this.apiUrl) {
      try {
        allowedOrigins.push(new URL(this.apiUrl).origin)
      } catch (e) {}
    }

    if (!allowedOrigins.includes(event.origin)) {
      return
    }

    // Validate message source and origin
    if (!event.data || event.data.source !== 'auxx-extension') {
      return
    }

    // Validate appId matches
    if (event.data.appId !== this.appId) {
      return
    }

    const { type, data, requestId } = event.data

    if (!type) {
      return
    }

    // Handle SDK ready signal
    if (type === 'sdk-ready') {
      if (data.error) {
        // SDK signaled an error during initialization
        const error = new Error(
          `SDK initialization failed: ${data.error}\n` +
            `App: ${this.appId}\n` +
            `This indicates the extension bundle failed to load or threw an error during initialization.`
        )
        if (this.sdkReadyReject) {
          this.sdkReadyReject(error)
        }
      } else {
        // SDK initialized successfully
        this.sdkReady = true
        if (this.sdkReadyResolve) {
          this.sdkReadyResolve()
        }
      }
      return
    }

    // Handle response to our request
    if (type === 'response' && requestId) {
      const pending = this.pendingRequests.get(requestId)
      if (pending) {
        this.pendingRequests.delete(requestId)
        if (data.error) {
          pending.reject(new Error(data.error))
        } else {
          pending.resolve(data.result)
        }
      }
      return
    }

    // Call all registered handlers for this message type
    const handlers = this.messageHandlers.get(type)

    if (!handlers || handlers.size === 0) {
      // Buffer the message for later replay when handler is registered
      if (!this.incomingMessageBuffer.has(type)) {
        this.incomingMessageBuffer.set(type, [])
      }
      this.incomingMessageBuffer.get(type)!.push(data)
      return
    }

    // Execute all handlers
    for (const handler of handlers) {
      try {
        const result = handler(data)
        if (result instanceof Promise) {
          result
            .then((res) => {
              if (requestId) {
                this.sendMessage(
                  'response',
                  {
                    result: res,
                  },
                  requestId
                )
              }
            })
            .catch((error) => {
              if (requestId) {
                this.sendMessage(
                  'response',
                  {
                    error: error.message || 'Unknown error',
                  },
                  requestId
                )
              }
            })
        } else if (requestId) {
          this.sendMessage(
            'response',
            {
              result,
            },
            requestId
          )
        }
      } catch (error: any) {
        if (requestId) {
          this.sendMessage(
            'response',
            {
              error: error.message || 'Unknown error',
            },
            requestId
          )
        }
      }
    }
  }

  /**
   * Flush queued messages.
   */
  private flushMessageQueue(): void {
    if (this.messageQueue.length === 0) return

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()
      if (message) {
        this.sendMessage(message.type, message.data)
      }
    }
  }

  /**
   * Destroy the message client and clean up resources.
   */
  destroy(): void {
    // Remove event listener
    window.removeEventListener('message', this.handleMessage)

    // Remove iframe
    if (this.iframe?.parentNode) {
      this.iframe.parentNode.removeChild(this.iframe)
    }

    // Reject all pending requests
    this.pendingRequests.forEach(({ reject }) => {
      reject(new Error('MessageClient destroyed'))
    })

    this.iframe = null
    this.isReady = false
    this.messageHandlers.clear()
    this.messageQueue = []
    this.pendingRequests.clear()
  }

  /**
   * Get unique key for this message client.
   */
  getKey(): string {
    return `${this.appId}:${this.appInstallationId}`
  }
}
