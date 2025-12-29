// apps/lambda/src/runtime-helpers/settings.ts

/**
 * Settings schema management for Lambda runtime
 *
 * Handles registration and validation of extension settings schemas.
 * Extensions can define organization and user-scoped settings through registerSettingsSchema().
 *
 * @module runtime-helpers/settings
 *
 * @example
 * ```typescript
 * import { registerSettingsSchema, getRegisteredSettingsSchema } from './settings'
 *
 * // Extension registers its settings schema during initialization
 * registerSettingsSchema({
 *   organization: {
 *     apiKey: { type: 'string', required: true },
 *     enabled: { type: 'boolean', default: false }
 *   },
 *   user: {
 *     theme: { type: 'string', enum: ['light', 'dark'] }
 *   }
 * })
 *
 * // Platform retrieves the schema to validate settings
 * const schema = getRegisteredSettingsSchema()
 * ```
 */

/**
 * Settings schema structure from @auxx/sdk
 *
 * Defines the structure for extension settings at different scopes.
 * Extensions call registerSettingsSchema() with this structure to define
 * what settings they need from users/organizations.
 *
 * @interface SettingsSchema
 * @property {Record<string, unknown>} [organization] - Organization-scoped settings (shared across all users)
 * @property {Record<string, unknown>} [user] - User-scoped settings (individual per user)
 *
 * @example
 * ```typescript
 * const schema: SettingsSchema = {
 *   organization: {
 *     apiUrl: {
 *       type: 'string',
 *       label: 'API URL',
 *       description: 'Your company API endpoint',
 *       required: true
 *     },
 *     maxRetries: {
 *       type: 'number',
 *       default: 3,
 *       min: 0,
 *       max: 10
 *     }
 *   },
 *   user: {
 *     notifications: {
 *       type: 'boolean',
 *       label: 'Enable notifications',
 *       default: true
 *     }
 *   }
 * }
 * ```
 */
export interface SettingsSchema {
  organization?: Record<string, unknown>
  user?: Record<string, unknown>
  // Future: workspace? for workspace-scoped settings
}

/**
 * Stored settings schema registered by extension
 */
let registeredSettingsSchema: SettingsSchema | null = null

/**
 * Register app settings schema
 *
 * Called by generated server entry code during bundle initialization.
 * Stores the schema in module-level state for later retrieval by the platform.
 *
 * Extensions use this to declare what settings they need from users/organizations.
 * The platform uses the registered schema to generate UI and validate settings values.
 *
 * @param {SettingsSchema} schema - The settings schema definition
 * @returns {void}
 *
 * @example
 * ```typescript
 * // In extension's server.ts initialization
 * registerSettingsSchema({
 *   organization: {
 *     slackWebhook: {
 *       type: 'string',
 *       label: 'Slack Webhook URL',
 *       description: 'Webhook URL for Slack notifications',
 *       required: true,
 *       pattern: '^https://hooks.slack.com/.*'
 *     },
 *     alertThreshold: {
 *       type: 'number',
 *       label: 'Alert Threshold',
 *       default: 100,
 *       min: 0
 *     }
 *   },
 *   user: {
 *     emailNotifications: {
 *       type: 'boolean',
 *       label: 'Email Notifications',
 *       default: false
 *     }
 *   }
 * })
 * ```
 */
export function registerSettingsSchema(schema: SettingsSchema): void {
  console.log('[RuntimeHelpers] Registering settings schema')
  registeredSettingsSchema = schema

  // TODO: Validate schema structure
  // TODO: Store schema in database for platform use
}

/**
 * Get the registered settings schema
 *
 * Returns the settings schema that was registered by the extension via registerSettingsSchema().
 * Used by the platform to:
 * - Generate settings UI forms
 * - Validate user-provided setting values
 * - Display help text and defaults
 *
 * @returns {SettingsSchema | null} The registered schema, or null if not registered yet
 *
 * @example
 * ```typescript
 * // Platform retrieves schema after bundle initialization
 * const schema = getRegisteredSettingsSchema()
 *
 * if (schema) {
 *   console.log('Organization settings:', schema.organization)
 *   console.log('User settings:', schema.user)
 *   // Use schema to generate UI and validate input
 * }
 * ```
 */
export function getRegisteredSettingsSchema(): SettingsSchema | null {
  return registeredSettingsSchema
}

/**
 * Reset registered schema
 *
 * Clears the module-level schema state. Called after execution to ensure
 * no state leaks between different extension executions.
 *
 * IMPORTANT: Always call this in cleanup phase to prevent memory leaks.
 *
 * @returns {void}
 *
 * @example
 * ```typescript
 * // In cleanup phase after extension execution
 * try {
 *   // ... execute extension code ...
 * } finally {
 *   resetSettingsSchema() // Clear state
 *   restoreConsole()
 * }
 * ```
 */
export function resetSettingsSchema(): void {
  registeredSettingsSchema = null
}
