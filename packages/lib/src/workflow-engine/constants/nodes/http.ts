// packages/lib/src/workflow-engine/constants/nodes/http.ts
import { createRangeValidator } from '../validation'
import type { NodeConstants } from '../types'

/**
 * Constants for HTTP node configuration
 */
export const HTTP_NODE_CONSTANTS = {
  // Retry configuration
  RETRY_CONFIG: {
    MAX_RETRIES: createRangeValidator({ min: 1, max: 10, default: 3 }),
    RETRY_INTERVAL: createRangeValidator({ min: 100, max: 60000, default: 1000 }), // milliseconds
  },

  // Timeout configuration
  TIMEOUT: {
    CONNECTION: createRangeValidator({ min: 1000, max: 60000, default: 10000 }), // milliseconds
    RESPONSE: createRangeValidator({ min: 1000, max: 300000, default: 30000 }), // milliseconds
    TOTAL: createRangeValidator({ min: 1000, max: 300000, default: 30000 }), // milliseconds
  },

  // HTTP methods
  METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] as const,

  // Body types
  BODY_TYPES: ['none', 'json', 'form-data', 'x-www-form-urlencoded', 'raw'] as const,

  // Authentication types
  AUTH_TYPES: ['none', 'basic', 'bearer', 'api-key'] as const,

  // API key locations
  API_KEY_LOCATIONS: ['header', 'query'] as const,

  // Follow redirect options
  FOLLOW_REDIRECT_OPTIONS: ['follow', 'manual', 'error'] as const,

  // Headers
  HEADERS: {
    MAX_COUNT: 50,
    KEY_MAX_LENGTH: 256,
    VALUE_MAX_LENGTH: 8192,
  },

  // Query parameters
  QUERY_PARAMS: {
    MAX_COUNT: 100,
    KEY_MAX_LENGTH: 256,
    VALUE_MAX_LENGTH: 2048,
  },

  // Request body
  BODY: {
    MAX_SIZE: 10 * 1024 * 1024, // 10MB
  },
} as const satisfies NodeConstants

// Type exports for better type inference
export type HttpMethod = (typeof HTTP_NODE_CONSTANTS.METHODS)[number]
export type HttpBodyType = (typeof HTTP_NODE_CONSTANTS.BODY_TYPES)[number]
export type HttpAuthType = (typeof HTTP_NODE_CONSTANTS.AUTH_TYPES)[number]
export type ApiKeyLocation = (typeof HTTP_NODE_CONSTANTS.API_KEY_LOCATIONS)[number]
export type FollowRedirectOption = (typeof HTTP_NODE_CONSTANTS.FOLLOW_REDIRECT_OPTIONS)[number]

// Helper type for retry config
export interface HttpRetryConfig {
  enabled: boolean
  max_retries: number
  retry_interval: number
}

// Helper type for timeout config
export interface HttpTimeoutConfig {
  connection_timeout: number
  response_timeout: number
  total_timeout: number
}
