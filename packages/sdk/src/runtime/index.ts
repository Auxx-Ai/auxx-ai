// packages/sdk/src/runtime/index.ts

/**
 * Platform Runtime Entry Point
 *
 * This is the main runtime SDK that executes inside an iframe to provide a sandboxed
 * execution environment for third-party extensions.
 *
 * ## Compilation Process
 *
 * This file is compiled using esbuild and bundled as an IIFE (Immediately Invoked Function Expression)
 * for browser execution:
 *
 * 1. **Build Tool**: esbuild (configured in packages/sdk/src/build/platform-runtime/build.ts)
 * 2. **Entry Point**: packages/sdk/src/runtime/index.ts
 * 3. **Format**: IIFE (browser-ready, self-executing)
 * 4. **Target**: ES2020
 * 5. **Output**: apps/api/public/app-runtime/platform.{HASH}.js
 * 6. **Cache Busting**: SHA1 hash (8 chars) appended to filename
 * 7. **Loaded By**: apps/api/public/app-runtime/index.html (iframe HTML)
 *
 * ## Build Commands
 *
 * Development (with watch): `pnpm run dev:platform-runtime --filter @auxx/api`
 * Production: `NODE_ENV=production pnpm run build:platform-runtime --filter @auxx/api`
 *
 * ## Runtime Initialization Sequence
 *
 * 1. Parse environment from URL parameters
 * 2. Initialize Host communication (iframe ↔ parent app)
 * 3. Inject global SDK APIs into window
 * 4. Set up Host request handlers
 * 5. Load extension bundle dynamically
 * 6. Render extension App component (if present)
 */

import React from 'react'
import * as ClientSDK from '../client/index.js'
import * as RootSDK from '../root/index.js'
import { ExtensionInitError, ExtensionLoadError } from '../shared/errors.js'
import * as SharedSDK from '../shared/index.js'
import { eventBus } from './event-bus.js'
import { Host } from './host.js'
import { render } from './reconciler/reconciler.js'
import type { SanitizedInstance } from './reconciler/types.js'
import { runServerFunction } from './run-server-function.js'
import { SURFACES } from './surfaces.js'
import './workflow.js' // Import workflow runtime handlers

// Export for client SDK imports
export { SURFACES, Host }

/**
 * Tracks the lifecycle state of actively rendered components.
 *
 * This map maintains render state for components that are currently displayed
 * (e.g., dialogs, modals, widgets). Each entry tracks whether the component's
 * initial render has completed, which determines whether subsequent updates
 * should be sent to the host.
 *
 * @remarks
 * - **Key**: Component ID (unique identifier for the rendered instance)
 * - **Value**: Render state object containing:
 *   - `isInitialRenderComplete`: Whether the first render cycle has finished
 *
 * ## Lifecycle
 * 1. Entry is created when component render is requested
 * 2. `isInitialRenderComplete` is set to `true` after first render
 * 3. Subsequent renders trigger updates to the host
 * 4. Entry is removed when component is unrendered (cleanup)
 *
 * @see cleanupComponentRender - Removes entries when components are destroyed
 * @see setupHostHandlers - Creates entries in 'render-component' handler
 */
const activeComponentRenders = new Map<
  string,
  {
    isInitialRenderComplete: boolean
  }
>()

/**
 * Runtime environment configuration extracted from URL query parameters.
 *
 * The iframe URL contains all necessary context for the extension to run,
 * passed as query parameters by the parent application.
 *
 * @example
 * ```
 * /app-runtime/index.html?
 *   appId=app_123&
 *   appInstallationId=install_456&
 *   organizationId=org_789&
 *   extensionBundleUrl=https://cdn.example.com/bundle.js&
 *   webAppOrigin=https://app.auxx.ai
 * ```
 */
interface RuntimeEnvironment {
  /** Unique identifier for the app/extension */
  appId: string

  /** Unique identifier for this specific installation of the app */
  appInstallationId: string

  /** Organization ID where the app is installed */
  organizationId: string

  /** URL-friendly handle for the organization (e.g., "acme-corp") */
  organizationHandle: string

  /** Display name of the organization */
  organizationName: string

  /** Unique identifier of the current user (nullish for system-level triggers like polling) */
  userId?: string | null

  /** Display name of the current user (nullish for system-level triggers like polling) */
  userName?: string | null

  /** Email address of the current user */
  userEmail?: string | null

  /** Base URL for API requests (e.g., "https://api.auxx.ai") */
  apiUrl: string

  /** Platform identifier (e.g., "web-app", "mobile") */
  platform: string

  /** Whether running in development mode (affects logging, minification) */
  isDevelopment: boolean

  /** URL to the extension's bundled JavaScript code */
  extensionBundleUrl: string

  /** Origin of the parent web application (for postMessage security) */
  webAppOrigin: string

  /** Version identifier of the extension or runtime */
  version: string
}

/**
 * Removes component render tracking when a component is destroyed.
 *
 * This function is called when a component is unrendered (e.g., dialog closes,
 * widget is removed) to clean up render state and prevent memory leaks.
 *
 * @param id - Unique identifier of the component to clean up
 *
 * @remarks
 * After cleanup, subsequent render commits will be ignored for this component ID,
 * preventing updates from being sent to the host for a destroyed component.
 *
 * This function is exposed globally via the Globals object and can be called
 * by SURFACES when components are unrendered.
 *
 * @see activeComponentRenders - The map that stores render state
 * @see SURFACES.componentUnrenderRequested - Event that triggers cleanup
 */
function cleanupComponentRender(id: string): void {
  activeComponentRenders.delete(id)
}

/**
 * Global APIs injected into the extension's execution context.
 *
 * These functions and objects are made available globally (on `window`) before
 * the extension bundle is loaded, allowing extensions to access platform capabilities.
 *
 * @remarks
 * All properties in this object are injected into `globalThis` during runtime
 * initialization (see main() function). Extensions can then call these functions
 * to register UI components, handle events, and communicate with the host.
 *
 * ## Security
 * These globals are only available within the sandboxed iframe environment,
 * not in the parent application.
 *
 * @see main - Where globals are injected into window
 */
const Globals = {
  /**
   * React library reference.
   * Shared React instance to ensure single version across runtime and extensions.
   */
  React,

  /**
   * Clean up component render tracking.
   * Exposed globally for SURFACES to call when components are destroyed.
   *
   * @see cleanupComponentRender
   */
  cleanupComponentRender,

  /**
   * Registers UI surfaces (actions, widgets) with the platform.
   *
   * Extensions call this function (typically in their entry file) to declare
   * what UI components they provide to the host application.
   *
   * @param surfaces - Surface definitions (array or object grouped by type)
   *
   * @remarks
   * Accepts two formats:
   * 1. **Array**: `[surface1, surface2, ...]`
   * 2. **Object by type**: `{ actions: [...], widgets: [...] }`
   *
   * After registration, surfaces are serialized and sent to the host via
   * the 'set-surfaces' message.
   *
   * @example
   * ```typescript
   * registerSurfaces([
   *   { type: 'action', id: 'send-email', label: 'Send Email', ... },
   *   { type: 'widget', id: 'dashboard', label: 'Dashboard', ... }
   * ])
   * ```
   *
   * @see SURFACES.registerMany - Actual registration logic
   */
  registerSurfaces: (surfaces: any) => {
    if (Array.isArray(surfaces)) {
      SURFACES.registerMany(surfaces)
    } else if (typeof surfaces === 'object') {
      const surfaceArray: any[] = []
      for (const [_surfaceType, surfaceList] of Object.entries(surfaces)) {
        if (Array.isArray(surfaceList)) {
          surfaceArray.push(...surfaceList)
        }
      }
      SURFACES.registerMany(surfaceArray)
    }

    Host.sendMessage('set-surfaces', { surfaces: SURFACES.getAllSerializableByType() })
  },

  /**
   * Registers static assets (icons, images) with the platform.
   *
   * Extensions use this to declare images, icons, or other static resources
   * that the host application should load or cache.
   *
   * @param assets - Array of asset definitions
   *
   * @remarks
   * Assets are typically referenced by ID in surface definitions or components.
   * The host receives these assets via the 'set-assets' message and can
   * pre-load or cache them as needed.
   *
   * @example
   * ```typescript
   * registerAssets([
   *   { id: 'logo', url: 'https://cdn.example.com/logo.png', type: 'image' },
   *   { id: 'icon-email', url: 'https://cdn.example.com/email.svg', type: 'icon' }
   * ])
   * ```
   */
  registerAssets: (assets: any) => {
    Host.sendMessage('set-assets', { assets })
  },

  /**
   * Registers the extension's settings schema with the platform.
   *
   * Defines the structure and validation rules for extension settings that
   * users can configure in the host application's settings UI.
   *
   * @param schema - Settings schema definition (typically JSON Schema or similar)
   *
   * @remarks
   * The schema defines:
   * - Available settings fields
   * - Field types and validation rules
   * - Default values
   * - UI hints (labels, descriptions, grouping)
   *
   * The host uses this schema to generate a settings form and validate user input.
   *
   * @example
   * ```typescript
   * registerSettingsSchema({
   *   apiKey: { type: 'string', label: 'API Key', required: true },
   *   enableNotifications: { type: 'boolean', label: 'Enable Notifications', default: true }
   * })
   * ```
   */
  registerSettingsSchema: (schema: any) => {
    Host.sendMessage('set-settings-schema', { schema })
  },

  /**
   * Executes server-side functions from the client context.
   *
   * @remarks
   * **INTERNAL USE ONLY** - Not exposed in public SDK types.
   *
   * The extension bundler automatically rewrites server function implementations
   * to call this function, which sends a request to the host to execute the
   * server code in a secure backend environment.
   *
   * This enables extensions to write server logic (database queries, API calls)
   * that runs on the server but can be called from client components.
   *
   * @see runServerFunction - Implementation of server function execution
   */
  runServerFunction,
}

/**
 * Main runtime initialization function.
 *
 * Orchestrates the complete startup sequence for the extension runtime environment.
 * This function is called immediately when the platform bundle loads in the iframe.
 *
 * @throws {ExtensionInitError} If required environment parameters are missing
 * @throws {ExtensionLoadError} If the extension bundle fails to load
 *
 * @remarks
 * ## Initialization Sequence
 *
 * 1. **Parse Environment** - Extract configuration from URL query parameters
 * 2. **Initialize Host** - Set up bidirectional communication with parent app
 * 3. **Inject Globals** - Make SDK APIs available to extension code
 * 4. **Setup Handlers** - Register request/response handlers for host messages
 * 5. **Start Reset Cycle** - Prepare surface registry for re-registration
 * 6. **Load Extension Bundle** - Dynamically load extension's JavaScript
 * 7. **End Reset Cycle** - Finalize surface registration
 * 8. **Render App** - Execute extension's App component (if present)
 *
 * ## Error Handling
 *
 * - Missing environment parameters throw immediately
 * - Bundle loading errors are caught and reported to host via 'render-error' message
 * - Rendering errors are caught and reported with error code
 *
 * ## Async Behavior
 *
 * Step 6-8 run in a setTimeout to ensure the current macrotask completes,
 * allowing any synchronous initialization to finish before loading external code.
 *
 * @see parseEnvironment - Extracts runtime configuration
 * @see Host.initialize - Sets up iframe ↔ parent communication
 * @see setupHostHandlers - Registers message handlers
 * @see loadExtensionBundle - Dynamically loads extension code
 * @see renderExtensionApp - Renders extension UI
 */
async function main() {
  try {
    // 1. Parse environment from URL params
    const env = parseEnvironment()

    if (!env.extensionBundleUrl || !env.webAppOrigin) {
      throw new ExtensionInitError('Missing required environment parameters')
    }

    // 2. Initialize Host communication
    Host.initialize({
      webAppOrigin: env.webAppOrigin,
      appId: env.appId,
      appInstallationId: env.appInstallationId,
    })

    // 3. Set up globals BEFORE loading extension
    // inject all globals first
    for (const property in Globals) {
      ;(globalThis as any)[property] = Globals[property as keyof typeof Globals]
    }
    // Also set up SDK namespaces
    ;(globalThis as any).AUXX_CLIENT_EXTENSION_SDK = ClientSDK
    ;(globalThis as any).AUXX_SHARED_SDK = SharedSDK
    ;(globalThis as any).AUXX_ROOT_SDK = RootSDK
    ;(globalThis as any).AUXX = {
      client: ClientSDK,
      shared: SharedSDK,
      React,
    }
    // Make React available at window.React for SDK components that expect it there
    ;(globalThis as any).React = React
    // Also set on window for workflow components that access window.React
    if (typeof window !== 'undefined') {
      ;(window as any).React = React
    }
    ;(globalThis as any).__AUXX_CLIENT_ENV__ = env

    // 4. Set up Host request handlers
    setupHostHandlers()

    // 5. Start surface reset cycle
    SURFACES.startReset()

    // 6. Load extension bundle
    // Use setTimeout to let current macrotask complete
    setTimeout(async () => {
      try {
        await loadExtensionBundle(env.extensionBundleUrl)

        // 7. End surface reset cycle
        SURFACES.endReset()

        // 8. Render extension App
        await renderExtensionApp()

        // 9. Signal that SDK is fully initialized and ready
        // This is sent after extension bundle loads and surfaces are registered
        Host.sendMessage('sdk-ready', {})
      } catch (error: any) {
        console.error('[Runtime] Fatal error during bundle loading:', error)

        // Send render-error for backwards compatibility
        Host.sendMessage('render-error', {
          error: error.message || 'Unknown error',
          code: error.code || 'INIT_ERROR',
        })

        // CRITICAL: Also send sdk-ready with error flag to prevent MessageClient timeout
        // This ensures the MessageClient gets a response even when initialization fails
        Host.sendMessage('sdk-ready', {
          error: error.message || 'Unknown error',
          code: error.code || 'INIT_ERROR',
        })
      }
    }, 0)
  } catch (error: any) {
    console.error('[Runtime] Fatal initialization error:', error)
    throw error
  }
}

/**
 * Registers all request handlers for host-to-runtime communication.
 *
 * Sets up bidirectional message handlers that allow the parent application
 * to request actions from the runtime (component rendering, event triggers, etc.)
 * and receive responses.
 *
 * @remarks
 * ## Registered Handlers
 *
 * 1. **'render-component'** - Renders a dialog/modal component on demand
 *    - Creates persistent render with update tracking
 *    - Sends updates back to host when component re-renders
 *    - Returns initial render result synchronously
 *
 * 2. **'render-widget'** - Renders a widget surface
 *    - Delegates to SURFACES.requestWidgetRender()
 *    - Passes context and instance information
 *
 * 3. **'trigger-surface'** - Executes a surface action (e.g., button click)
 *    - Calls the surface's trigger function
 *    - Sends success/error messages back to host
 *
 * 4. **'call-instance-method'** - Invokes event handlers on rendered components
 *    - Looks up handler via EventBus
 *    - Calls handler and returns result
 *    - Returns error if handler not found
 *
 * ## Listeners
 *
 * - **componentUnrenderRequested** - Notifies host when component should close
 *
 * @see Host.onRequest - Registers async request handlers
 * @see Host.sendMessage - Sends one-way messages to host
 * @see SURFACES - Surface registry and execution
 * @see eventBus - Event handler lookup and invocation
 */
function setupHostHandlers() {
  // Handle component render requests
  Host.onRequest('render-component', async ({ id }: { id: string }) => {
    try {
      const component = SURFACES.getRenderedComponent(id)
      if (!component) {
        return { error: { code: 'COMPONENT_NOT_FOUND', message: `Component ${id} not found` } }
      }

      // Track this render
      const renderState = {
        isInitialRenderComplete: false,
      }
      activeComponentRenders.set(id, renderState)

      let sanitizedChildren: SanitizedInstance[] = []

      // Set up persistent render that sends updates
      const renderPromise = render({
        element: component,
        onCommit: (children: SanitizedInstance[]) => {
          // Check if component is still active (not cleaned up)
          if (!activeComponentRenders.has(id)) {
            return
          }

          sanitizedChildren = children

          // After initial render, send updates to platform
          if (renderState.isInitialRenderComplete) {
            Host.sendMessage('component-updated', {
              id,
              component: { children },
            })
          }
        },
        onCallInstanceMethod: async (_instanceId: number, _method: string, _args: any[]) => {
          return undefined
        },
      })

      // Wait for initial render to complete
      await renderPromise
      renderState.isInitialRenderComplete = true

      return { success: true, component: { children: sanitizedChildren } }
    } catch (error: any) {
      return { error: { code: 'RENDER_ERROR', message: error.message } }
    }
  })

  // Handle widget render requests
  Host.onRequest('render-widget', async (data: any) => {
    const { surfaceId, instanceId, context } = data
    SURFACES.requestWidgetRender({ surfaceId, instanceId, ...context })
  })

  // Handle surface trigger requests
  Host.onRequest('trigger-surface', async (data: any) => {
    const { surfaceId, payload, triggerId } = data

    try {
      await SURFACES.executeTrigger(surfaceId, payload)
      Host.sendMessage('surface-trigger-complete', { triggerId, surfaceId })
    } catch (error: any) {
      Host.sendMessage('surface-trigger-error', {
        triggerId,
        surfaceId,
        error: error.message || 'Unknown error',
      })
    }
  })

  // Handle event handler calls from platform
  Host.onRequest('call-instance-method', async (data: any) => {
    const { instanceId, eventName, args = [] } = data

    try {
      // Call via EventBus instead of directly on tag
      if (!eventBus.hasTagEventListener(eventName, instanceId)) {
        return {
          error: {
            code: 'HANDLER_NOT_FOUND',
            message: `Handler ${eventName} not found for instance ${instanceId}`,
          },
        }
      }

      const result = await eventBus.callTagEventListener(eventName, instanceId, args)
      return { success: true, result }
    } catch (error: any) {
      console.error('[Runtime] Error calling handler:', error)
      return { error: { code: 'HANDLER_ERROR', message: error.message } }
    }
  })

  // Handle component unrender
  SURFACES.componentUnrenderRequested.addListener(({ id }) => {
    Host.sendMessage('unrender-component', { id })
  })
}

/**
 * Extracts runtime configuration from URL query parameters.
 *
 * Parses the iframe's URL query string to build the runtime environment
 * configuration object. The parent application passes all necessary context
 * as URL parameters when creating the iframe.
 *
 * @returns {RuntimeEnvironment} Parsed configuration object
 *
 * @remarks
 * ## Required Parameters
 * - `extensionBundleUrl` - URL to extension's JavaScript bundle
 * - `webAppOrigin` - Parent app origin (for postMessage security)
 *
 * ## Optional Parameters
 * All other parameters default to empty strings if not provided.
 * - `platform` defaults to 'web-app' if not specified
 * - `isDevelopment` is parsed as boolean (only 'true' = true, else false)
 *
 * ## Security
 * The `webAppOrigin` parameter is critical for postMessage validation,
 * ensuring messages are only sent to/from the expected parent application.
 *
 * @example
 * ```typescript
 * // URL: /app-runtime/index.html?appId=app_123&webAppOrigin=https://app.auxx.ai
 * const env = parseEnvironment()
 * // => { appId: 'app_123', webAppOrigin: 'https://app.auxx.ai', ... }
 * ```
 *
 * @see RuntimeEnvironment - Return type definition
 * @see main - Where this function is called during initialization
 */
function parseEnvironment(): RuntimeEnvironment {
  const params = new URLSearchParams(window.location.search)

  return {
    appId: params.get('appId') || '',
    appInstallationId: params.get('appInstallationId') || '',
    organizationId: params.get('organizationId') || '',
    organizationHandle: params.get('organizationHandle') || '',
    organizationName: params.get('organizationName') || '',
    userId: params.get('userId') || '',
    userName: params.get('userName') || '',
    userEmail: params.get('userEmail') || '',
    apiUrl: params.get('apiUrl') || '',
    platform: params.get('platform') || 'web-app',
    isDevelopment: params.get('isDevelopment') === 'true',
    extensionBundleUrl: params.get('extensionBundleUrl') || '',
    webAppOrigin: params.get('webAppOrigin') || '',
    version: params.get('version') || '',
  }
}

/**
 * Dynamically loads the extension's JavaScript bundle into the iframe.
 *
 * Creates a script tag and injects it into the document head, loading the
 * extension's compiled JavaScript from the provided URL. The bundle executes
 * in the global scope with access to the injected SDK globals.
 *
 * @param bundleUrl - URL of the extension's JavaScript bundle
 * @returns Promise that resolves when bundle loads successfully
 * @throws {ExtensionLoadError} If the script fails to load (404, network error, etc.)
 *
 * @remarks
 * ## Loading Process
 * 1. Creates a `<script>` element with `type="text/javascript"`
 * 2. Sets `src` to the provided bundle URL
 * 3. Appends to `document.head`
 * 4. Waits for load or error event
 *
 * ## Extension Bundle Behavior
 * When the bundle executes, it typically:
 * - Accesses global SDK APIs (React, AUXX, registerSurfaces, etc.)
 * - Defines components and surfaces
 * - Calls registration functions to declare UI entry points
 * - May define a global `App` component for rendering
 *
 * ## Security
 * The bundle URL should be validated and trusted before calling this function.
 * Untrusted bundles can execute arbitrary code within the iframe's context.
 *
 * @example
 * ```typescript
 * await loadExtensionBundle('https://cdn.example.com/extensions/app_123/bundle.js')
 * // Extension code now loaded and executed
 * ```
 *
 * @see main - Where this function is called during initialization
 * @see Globals - APIs available to the extension bundle
 */
async function loadExtensionBundle(bundleUrl: string): Promise<void> {
  const loadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = bundleUrl
    script.type = 'text/javascript'

    script.onload = () => {
      resolve()
    }

    script.onerror = (error) => {
      console.error('[Runtime] Failed to load bundle:', error)
      reject(new ExtensionLoadError(`Failed to load bundle from ${bundleUrl}`))
    }

    document.head.appendChild(script)
  })

  // Add network timeout to prevent indefinite hangs
  const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(() => {
      reject(
        new ExtensionLoadError(
          `Bundle load timeout after 8000ms\n` +
            `URL: ${bundleUrl}\n` +
            `The extension bundle failed to download within the timeout period. ` +
            `This may indicate network issues, slow connection, or unavailable bundle URL.`
        )
      )
    }, 8000) // 8 second timeout for bundle loading
  })

  return Promise.race([loadPromise, timeoutPromise])
}

/**
 * Renders the extension's root App component using the custom React reconciler.
 *
 * Checks if the extension has defined a global `App` component and renders it
 * if present. Extensions without UI (server-only extensions like workflow blocks,
 * webhooks, or background jobs) may skip defining an App component.
 *
 * @returns Promise that resolves when initial render is complete
 *
 * @remarks
 * ## App Component Detection
 * - Looks for `globalThis.App` which the extension bundle should define
 * - If no App component exists, logs message and returns early
 * - This allows server-only extensions without client UI
 *
 * ## Rendering Process
 * 1. Creates React element from App component
 * 2. Passes element to custom reconciler (`render()`)
 * 3. Sets up commit callback to send UI tree to host
 * 4. Sets up method call handler for host-to-runtime communication
 *
 * ## Callbacks
 *
 * **onCommit**: Called when React commits a render
 * - Receives sanitized instance tree representing the UI
 * - Sends 'render' message to host with updated tree
 * - Host uses this to reconstruct and display the UI
 *
 * **onCallInstanceMethod**: Called when host wants to invoke event handler
 * - Receives instance ID, method name, and arguments
 * - Forwards request back to host (creates request loop for delegation)
 * - Returns result from handler execution
 *
 * ## Server-Only Extensions
 * Extensions that only provide server functionality don't need an App component:
 * - Workflow blocks (server-side execution only)
 * - Webhooks (triggered by external events)
 * - Background jobs (cron, queue workers)
 * - API endpoints (server routes)
 *
 * @example
 * ```typescript
 * // Extension with UI (defines App globally)
 * globalThis.App = () => <div>My Extension UI</div>
 * await renderExtensionApp() // Renders the component
 *
 * // Server-only extension (no App)
 * // (no global App defined)
 * await renderExtensionApp() // Logs message and returns
 * ```
 *
 * @see render - Custom React reconciler implementation
 * @see main - Where this function is called during initialization
 */
async function renderExtensionApp(): Promise<void> {
  const App = (globalThis as any).App

  if (!App) {
    return
  }

  await render({
    element: React.createElement(App),
    onCommit: (committedChildren: SanitizedInstance[]) => {
      // Only send if not empty or changed
      Host.sendMessage('render', {
        root: { children: committedChildren },
      })
    },
    onCallInstanceMethod: async (instanceId: number, method: string, args: any[]) => {
      const result = await Host.sendRequest('call-instance-method', {
        instanceId,
        method,
        args,
      })
      return result
    },
  })
}

// Start the runtime
main()
