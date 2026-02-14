// packages/lib/src/workflow-engine/constants/nodes/crud.ts

import type { NodeConstants } from '../types'
import { createRangeValidator } from '../validation'

/**
 * Constants for CRUD node configuration
 */
export const CRUD_NODE_CONSTANTS = {
  // Resource types
  RESOURCE_TYPES: ['contact', 'ticket'] as const,

  // Operation modes
  OPERATION_MODES: ['create', 'update', 'delete'] as const,

  // Error strategies
  ERROR_STRATEGIES: ['fail', 'continue', 'default'] as const,

  // Default values
  DEFAULT_VALUES: {
    MAX_COUNT: 20,
    KEY_MAX_LENGTH: 100,
    VALUE_MAX_LENGTH: 1000,
  },

  // Field validation
  FIELDS: {
    MAX_COUNT: 50,
    KEY_MAX_LENGTH: 100,
    VALUE_MAX_LENGTH: 2000,
  },

  // Retry configuration (if needed in future)
  RETRY_CONFIG: {
    MAX_RETRIES: createRangeValidator({ min: 0, max: 5, default: 0 }),
    RETRY_INTERVAL: createRangeValidator({ min: 100, max: 30000, default: 1000 }), // milliseconds
  },

  // Timeout configuration (if needed in future)
  TIMEOUT: {
    CONNECTION: createRangeValidator({ min: 1000, max: 60000, default: 10000 }), // milliseconds
    OPERATION: createRangeValidator({ min: 1000, max: 300000, default: 30000 }), // milliseconds
  },
} as const satisfies NodeConstants

// Type exports for better type inference
export type CrudResourceType = (typeof CRUD_NODE_CONSTANTS.RESOURCE_TYPES)[number]
export type CrudOperationMode = (typeof CRUD_NODE_CONSTANTS.OPERATION_MODES)[number]
export type CrudErrorStrategy = (typeof CRUD_NODE_CONSTANTS.ERROR_STRATEGIES)[number]

// Helper type for default values
export interface CrudDefaultValueConfig {
  key: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  value: string
}

// Helper type for field configuration
export interface CrudFieldConfig {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  required?: boolean
  description?: string
  placeholder?: string
}
