// packages/services/src/app-connections/utils.ts

import { createScopedLogger } from '@auxx/logger'

/**
 * Logger instance for app-connections service
 *
 * This scoped logger is used throughout the app-connections service for
 * consistent logging with the 'app-connections' prefix. All log messages
 * from this service will be tagged with this scope for easier filtering
 * and debugging.
 *
 * @constant
 * @type {Logger}
 */
export const logger = createScopedLogger('app-connections')

/**
 * Safely serialize metadata to avoid circular references and non-serializable values
 *
 * This utility function is primarily used when triggering app events that include
 * connection metadata. It ensures that the metadata can be safely serialized to JSON
 * without throwing errors due to circular references or special objects like Date,
 * RegExp, etc.
 *
 * The function uses JSON.parse(JSON.stringify()) to create a deep copy that strips
 * out any non-serializable values. This is necessary because:
 * 1. Event handlers may receive metadata from OAuth providers with circular refs
 * 2. Metadata may contain class instances or other non-plain objects
 * 3. We need to guarantee the data can be safely stored or transmitted
 *
 * @param {Record<string, unknown> | undefined | null} metadata - The metadata object to serialize.
 *                                                                Can be null or undefined.
 * @param {boolean} [fallbackOnError=false] - Whether to return an empty object on serialization error.
 *                                            If false (default), returns undefined on error.
 *                                            If true, returns an empty object {} on error.
 *
 * @returns {Record<string, unknown> | undefined} The safely serialized metadata object,
 *                                                or undefined if input is null/undefined or serialization fails.
 *                                                Returns {} if fallbackOnError is true and serialization fails.
 *
 * @example
 * // Returns serialized metadata
 * const metadata = { scope: 'read:user', expiresIn: 3600 }
 * const safe = safeSerializeMetadata(metadata)
 * // safe = { scope: 'read:user', expiresIn: 3600 }
 *
 * @example
 * // Returns undefined for circular references (with fallbackOnError=false)
 * const circular: any = { a: 1 }
 * circular.self = circular
 * const safe = safeSerializeMetadata(circular)
 * // safe = undefined (and warning logged)
 *
 * @example
 * // Returns {} for circular references (with fallbackOnError=true)
 * const circular: any = { a: 1 }
 * circular.self = circular
 * const safe = safeSerializeMetadata(circular, true)
 * // safe = {} (and warning logged)
 */
export function safeSerializeMetadata(
  metadata: Record<string, unknown> | undefined | null,
  fallbackOnError = false
): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined
  }

  try {
    // Parse and re-stringify to remove circular references and non-serializable values
    return JSON.parse(JSON.stringify(metadata))
  } catch (error) {
    logger.warn('Failed to serialize metadata', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return fallbackOnError ? {} : undefined
  }
}
