// apps/lambda/src/runtime-helpers/index.ts

/**
 * Server-side runtime helpers for extension execution
 *
 * Main entry point that orchestrates runtime helper injection and cleanup.
 * These functions are injected into the global scope before executing
 * extension server code, similar to how the client runtime works.
 *
 * @module runtime-helpers
 *
 * This module provides:
 * - **Settings Management**: registerSettingsSchema() for declaring extension settings
 * - **Server SDK**: Full @auxx/sdk/server implementation (connections, webhooks, fetch, etc.)
 * - **Console Interception**: Captures console.log/warn/error for display in platform
 * - **Orchestration**: injectServerRuntimeHelpers() and cleanupServerRuntimeHelpers()
 *
 * @example
 * ```typescript
 * import {
 *   injectServerRuntimeHelpers,
 *   cleanupServerRuntimeHelpers,
 *   getCapturedLogs
 * } from './runtime-helpers'
 *
 * // 1. Setup before extension execution
 * injectServerRuntimeHelpers(context)
 *
 * // 2. Execute extension code
 * // Extension can now use:
 * //   - registerSettingsSchema()
 * //   - AUXX_SERVER_SDK.getCurrentUser()
 * //   - AUXX_SERVER_SDK.fetch()
 * //   - console.log() (captured)
 *
 * // 3. Cleanup after execution
 * const logs = getCapturedLogs()
 * cleanupServerRuntimeHelpers()
 * ```
 */

import * as RootSDK from '@auxx/sdk'
import type { RuntimeContext } from '../types.ts'

// Re-export everything from console.ts
export {
  type ConsoleLog,
  clearCapturedLogs,
  getCapturedLogs,
  interceptConsole,
  restoreConsole,
} from './console.ts'
// Re-export everything from server-sdk.ts
export {
  type Connection,
  createServerSDK,
  type ServerSDK,
  type ServerSDKFetchOptions,
  type ServerSDKFetchResponse,
  type WebhookHandler,
} from './server-sdk.ts'
// Re-export everything from settings.ts
export {
  getRegisteredSettingsSchema,
  registerSettingsSchema,
  resetSettingsSchema,
  type SettingsSchema,
} from './settings.ts'

// Re-export types
export type { GlobalThisExtensions } from './types.ts'

// Import functions for use in inject/cleanup
import { clearCapturedLogs, interceptConsole, restoreConsole } from './console.ts'
import { createServerSDK } from './server-sdk.ts'
import { registerSettingsSchema, resetSettingsSchema } from './settings.ts'
import type { GlobalThisExtensions } from './types.ts'

/**
 * Inject runtime helpers into global scope
 *
 * Sets up the complete runtime environment before executing extension code.
 * This function must be called BEFORE running any extension bundle.
 *
 * What it does:
 * 1. Injects registerSettingsSchema() as global function
 * 2. Injects AUXX_ROOT_SDK for @auxx/sdk imports
 * 3. Injects AUXX_SERVER_SDK for @auxx/sdk/server imports
 * 4. Stores runtime context in global scope
 * 5. Clears previous logs and starts console interception
 *
 * IMPORTANT: Always pair with cleanupServerRuntimeHelpers() in a finally block
 * to prevent state leaks between executions.
 *
 * @param {RuntimeContext} context - Runtime execution context containing user, org, app info
 * @returns {void}
 *
 * @example
 * ```typescript
 * import { injectServerRuntimeHelpers, cleanupServerRuntimeHelpers } from './runtime-helpers'
 *
 * const context: RuntimeContext = {
 *   user: { id: 'user_123', email: 'john@example.com', name: 'John' },
 *   organization: { id: 'org_456', handle: 'acme', name: 'Acme Inc' },
 *   app: { id: 'app_789', installationId: 'inst_abc' },
 *   apiUrl: 'https://api.auxx.ai',
 *   fetch: globalThis.fetch,
 *   userConnection: {
 *     id: 'conn_123',
 *     type: 'oauth2-code',
 *     value: 'access_token_here'
 *   }
 * }
 *
 * try {
 *   // Setup runtime
 *   injectServerRuntimeHelpers(context)
 *
 *   // Execute extension bundle
 *   const extensionCode = await loadExtensionCode()
 *   const result = await eval(extensionCode)
 *
 *   // Retrieve logs
 *   const logs = getCapturedLogs()
 *
 *   return { result, logs }
 * } finally {
 *   // Always cleanup
 *   cleanupServerRuntimeHelpers()
 * }
 * ```
 */
export function injectServerRuntimeHelpers(context: RuntimeContext): void {
  console.log('[RuntimeHelpers] Injecting server runtime helpers')

  // DEBUG: Log what connections we received
  console.log('[RuntimeHelpers] Context connections:', {
    hasUserConnection: !!context.userConnection,
    hasOrgConnection: !!context.organizationConnection,
    userConnection: context.userConnection,
    orgConnection: context.organizationConnection,
  })

  const g = globalThis as typeof globalThis & GlobalThisExtensions

  // 1. Inject registerSettingsSchema as global function
  g.registerSettingsSchema = registerSettingsSchema

  // 2. Inject Root SDK (for @auxx/sdk imports like settings helpers)
  g.AUXX_ROOT_SDK = RootSDK

  // 3. Inject Server SDK as global (for @auxx/sdk/server imports)
  g.AUXX_SERVER_SDK = createServerSDK(context)

  // 4. Inject context (already done, but document it here)
  g.__AUXX_SERVER_CONTEXT__ = context

  // 5. Add helpful debug info
  g.__AUXX_SERVER_RUNTIME_VERSION__ = '1.0.0'

  // 6. Clear previous logs and intercept console
  clearCapturedLogs()
  interceptConsole()
}

/**
 * Clean up runtime helpers after execution
 *
 * Removes all runtime helpers from global scope and resets internal state.
 * This function MUST be called after extension execution to prevent state
 * leaks between different extension runs.
 *
 * What it does:
 * 1. Restores original console methods (stops log capture)
 * 2. Removes all injected globals (registerSettingsSchema, AUXX_SERVER_SDK, etc.)
 * 3. Resets settings schema state
 *
 * IMPORTANT:
 * - Call getCapturedLogs() BEFORE calling this function
 * - Always call this in a finally block to ensure cleanup happens
 * - This does NOT clear captured logs (executor needs to retrieve them first)
 *
 * @returns {void}
 *
 * @example
 * ```typescript
 * import {
 *   injectServerRuntimeHelpers,
 *   cleanupServerRuntimeHelpers,
 *   getCapturedLogs
 * } from './runtime-helpers'
 *
 * let logs: ConsoleLog[] = []
 *
 * try {
 *   injectServerRuntimeHelpers(context)
 *
 *   // Execute extension
 *   await executeExtensionCode()
 *
 *   // IMPORTANT: Get logs before cleanup
 *   logs = getCapturedLogs()
 * } catch (error) {
 *   console.error('Execution failed:', error)
 *   logs = getCapturedLogs()
 * } finally {
 *   // Always cleanup to prevent leaks
 *   cleanupServerRuntimeHelpers()
 * }
 *
 * // Now logs can be saved to database
 * await saveLogs(logs)
 * ```
 *
 * @example
 * ```typescript
 * // What cleanup does internally
 * cleanupServerRuntimeHelpers()
 *
 * // After cleanup, these globals are gone:
 * console.log(globalThis.registerSettingsSchema) // undefined
 * console.log(globalThis.AUXX_SERVER_SDK) // undefined
 * console.log(globalThis.AUXX_ROOT_SDK) // undefined
 *
 * // Console is back to normal (not captured)
 * console.log('This will not be captured')
 * ```
 */
export function cleanupServerRuntimeHelpers(): void {
  console.log('[RuntimeHelpers] Cleaning up server runtime helpers')

  // 1. Restore console FIRST (before logging cleanup message)
  restoreConsole()

  const g = globalThis as typeof globalThis & Partial<GlobalThisExtensions>

  // 2. Clean up globals
  delete g.registerSettingsSchema
  delete g.AUXX_ROOT_SDK
  delete g.AUXX_SERVER_SDK
  delete g.__AUXX_SERVER_CONTEXT__
  delete g.__AUXX_SERVER_RUNTIME_VERSION__

  // 3. Reset internal state
  resetSettingsSchema()
  // Note: Don't clear logs here - executor needs to retrieve them first
}
