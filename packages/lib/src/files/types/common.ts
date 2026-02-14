// packages/lib/src/files/shared-types/common.ts

/**
 * Shared common types and utilities for file upload system
 * Safe for import by both frontend and backend - contains no server dependencies
 */

/**
 * Generic API response wrapper
 */
export interface APIResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
  timestamp: string
  requestId?: string
}

/**
 * Error response structure
 */
export interface ErrorResponse {
  success: false
  error: string
  message: string
  code?: string
  details?: Record<string, any>
  timestamp: string
  requestId?: string
}

/**
 * Pagination options for list queries
 */
export interface PaginationOptions {
  limit?: number
  offset?: number
  page?: number
  pageSize?: number
}

/**
 * Pagination result metadata
 */
export interface PaginationMeta {
  total: number
  limit: number
  offset: number
  page: number
  pageSize: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> extends APIResponse<T[]> {
  meta: PaginationMeta
}

/**
 * Sort options for queries
 */
export interface SortOptions {
  field: string
  direction: 'asc' | 'desc'
}

/**
 * Filter options for queries
 */
export interface FilterOptions {
  field: string
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in' | 'nin'
  value: any
}

/**
 * Query options combining pagination, sorting, and filtering
 */
export interface QueryOptions {
  pagination?: PaginationOptions
  sort?: SortOptions[]
  filters?: FilterOptions[]
  search?: string
  include?: string[]
}

/**
 * Timestamped record interface
 */
export interface TimestampedRecord {
  createdAt: Date | string
  updatedAt: Date | string
  deletedAt?: Date | string
}

/**
 * Identifiable record interface
 */
export interface IdentifiableRecord {
  id: string
}

/**
 * Base record combining ID and timestamps
 */
export interface BaseRecord extends IdentifiableRecord, TimestampedRecord {
  version?: number
}

/**
 * Organization-scoped record
 */
export interface OrganizationScopedRecord {
  organizationId: string
}

/**
 * User-attributed record
 */
export interface UserAttributedRecord {
  createdById?: string
  updatedById?: string
}

/**
 * Complete base entity
 */
export interface BaseEntity extends BaseRecord, OrganizationScopedRecord, UserAttributedRecord {
  metadata?: Record<string, any>
}

/**
 * Connection state types
 */
export type ConnectionState =
  | 'disconnected' // Not connected
  | 'connecting' // Connection in progress
  | 'connected' // Successfully connected
  | 'reconnecting' // Attempting to reconnect
  | 'failed' // Connection failed

/**
 * Connection status information
 */
export interface ConnectionStatus {
  state: ConnectionState
  lastConnected?: Date
  reconnectAttempts: number
  error?: string
  latency?: number // ms
}

/**
 * SSE connection configuration
 */
export interface SSEConfig {
  autoConnect?: boolean // Auto-connect on initialization
  reconnectAttempts?: number // Maximum reconnection attempts
  reconnectDelay?: number // Delay between reconnection attempts (ms)
  heartbeatInterval?: number // Heartbeat interval (ms)
  timeout?: number // Connection timeout (ms)
  maxRetryDelay?: number // Maximum retry delay (ms)
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  maxRequests: number // Maximum requests
  windowMs: number // Time window in milliseconds
  skipSuccessfulRequests?: boolean
  skipFailedRequests?: boolean
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  ttl?: number // Time to live in seconds
  maxSize?: number // Maximum cache size
  staleWhileRevalidate?: number // Stale while revalidate time
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number // Maximum retry attempts
  baseDelay: number // Base delay between retries (ms)
  maxDelay: number // Maximum delay between retries (ms)
  exponentialBase?: number // Exponential backoff base
  jitter?: boolean // Add random jitter
}

/**
 * Health check result
 */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: string
  duration: number // Check duration in ms
  details?: Record<string, any>
}

/**
 * Feature flag configuration
 */
export interface FeatureFlag {
  name: string
  enabled: boolean
  conditions?: Record<string, any>
  rolloutPercentage?: number
}

/**
 * Environment configuration
 */
export interface EnvironmentInfo {
  environment: 'development' | 'staging' | 'production'
  version: string
  buildTime: string
  features: FeatureFlag[]
}

/**
 * Utility type for making properties optional
 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/**
 * Utility type for making properties required
 */
export type RequireBy<T, K extends keyof T> = T & Required<Pick<T, K>>

/**
 * Utility type for deep partial
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

/**
 * Utility type for omitting nested properties
 */
export type OmitNested<T, K extends string> = {
  [P in keyof T]: P extends K ? never : T[P] extends object ? OmitNested<T[P], K> : T[P]
}

/**
 * Utility functions for type guards
 */
export const TypeGuards = {
  /**
   * Check if value is defined and not null
   */
  isDefined: <T>(value: T | null | undefined): value is T => {
    return value !== null && value !== undefined
  },

  /**
   * Check if value is a non-empty string
   */
  isNonEmptyString: (value: any): value is string => {
    return typeof value === 'string' && value.length > 0
  },

  /**
   * Check if value is a valid number
   */
  isValidNumber: (value: any): value is number => {
    return typeof value === 'number' && !Number.isNaN(value) && isFinite(value)
  },

  /**
   * Check if value is a valid date
   */
  isValidDate: (value: any): value is Date => {
    return value instanceof Date && !Number.isNaN(value.getTime())
  },

  /**
   * Check if value is a plain object
   */
  isPlainObject: (value: any): value is Record<string, any> => {
    return typeof value === 'object' && value !== null && value.constructor === Object
  },

  /**
   * Check if value is an array
   */
  isArray: <T>(value: any): value is T[] => {
    return Array.isArray(value)
  },
} as const

/**
 * Utility functions for data transformation
 */
export const DataTransforms = {
  /**
   * Convert string to Date safely
   */
  toDate: (value: string | Date): Date => {
    return typeof value === 'string' ? new Date(value) : value
  },

  /**
   * Convert Date to ISO string safely
   */
  toISOString: (value: Date | string): string => {
    return typeof value === 'string' ? value : value.toISOString()
  },

  /**
   * Clamp number between min and max
   */
  clamp: (value: number, min: number, max: number): number => {
    return Math.max(min, Math.min(max, value))
  },

  /**
   * Round to specified decimal places
   */
  round: (value: number, decimals: number = 0): number => {
    const multiplier = 10 ** decimals
    return Math.round(value * multiplier) / multiplier
  },

  /**
   * Generate a random ID
   */
  generateId: (prefix?: string): string => {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substr(2, 9)
    return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`
  },
} as const
