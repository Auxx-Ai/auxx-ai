// packages/lib/src/workflow-engine/constants/index.ts

// Export all node constants
export * from './nodes'
// Export all types
export * from './types'
// Export validation utilities
export * from './validation'
export * from './wait'

// Common constants that apply across multiple nodes
export const COMMON_CONSTANTS = {
  // Variable name constraints
  VARIABLE_NAME: {
    MAX_LENGTH: 64,
    PATTERN: /^[a-zA-Z_][a-zA-Z0-9_]*$/,
  },

  // Common field limits
  FIELD_LIMITS: {
    SHORT_TEXT: 256,
    MEDIUM_TEXT: 1024,
    LONG_TEXT: 4096,
  },

  // Execution timeouts
  EXECUTION: {
    DEFAULT_TIMEOUT: 300000, // 5 minutes
    MAX_TIMEOUT: 3600000, // 1 hour
  },
} as const
