// apps/lambda/src/runtime-helpers/types.ts

/**
 * Shared type definitions for Lambda runtime helpers
 *
 * Defines TypeScript types for the global extensions injected by runtime helpers.
 *
 * @module runtime-helpers/types
 *
 * @example
 * ```typescript
 * // In extension code, globals are available
 * declare const globalThis: typeof globalThis & GlobalThisExtensions
 *
 * // Access injected SDK
 * const user = globalThis.AUXX_SERVER_SDK.getCurrentUser()
 *
 * // Register settings
 * globalThis.registerSettingsSchema({ organization: {...} })
 * ```
 */

import type * as RootSDK from '@auxx/sdk'
import type { RuntimeContext } from '../types.ts'
import type { ServerSDK } from './server-sdk.ts'
import type { SettingsSchema } from './settings.ts'

/**
 * Global extensions injected by runtime helpers
 *
 * Type definition for globals added to `globalThis` before extension execution.
 * Extensions can access these via global scope or via direct globalThis access.
 *
 * IMPORTANT: These are injected by injectServerRuntimeHelpers() and cleaned up
 * by cleanupServerRuntimeHelpers(). Do not manually set these globals.
 *
 * @interface GlobalThisExtensions
 * @property {Function} registerSettingsSchema - Register extension settings schema
 * @property {typeof RootSDK} AUXX_ROOT_SDK - Root SDK module (@auxx/sdk)
 * @property {ServerSDK} AUXX_SERVER_SDK - Server SDK implementation (@auxx/sdk/server)
 * @property {RuntimeContext} __AUXX_SERVER_CONTEXT__ - Current runtime context (internal)
 * @property {string} __AUXX_SERVER_RUNTIME_VERSION__ - Runtime version (internal)
 *
 * @example
 * ```typescript
 * // Type augmentation for extension code
 * declare global {
 *   var registerSettingsSchema: (schema: SettingsSchema) => void
 *   var AUXX_ROOT_SDK: typeof RootSDK
 *   var AUXX_SERVER_SDK: ServerSDK
 *   var __AUXX_SERVER_CONTEXT__: RuntimeContext
 *   var __AUXX_SERVER_RUNTIME_VERSION__: string
 * }
 *
 * // Extension can then use these directly
 * registerSettingsSchema({
 *   organization: {
 *     apiKey: { type: 'string', required: true }
 *   }
 * })
 *
 * const user = AUXX_SERVER_SDK.getCurrentUser()
 * const connection = AUXX_SERVER_SDK.getUserConnection()
 * ```
 */
export interface GlobalThisExtensions {
  registerSettingsSchema: (schema: SettingsSchema) => void
  AUXX_ROOT_SDK: typeof RootSDK
  AUXX_SERVER_SDK: ServerSDK
  __AUXX_SERVER_CONTEXT__: RuntimeContext
  __AUXX_SERVER_RUNTIME_VERSION__: string
}
