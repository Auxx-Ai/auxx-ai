// packages/types/config/index.ts
// Application-level enums for the config variables system (not Drizzle pgEnums)

// ============================================================================
// KEY VALUE PAIR TYPE
// ============================================================================

/** Discriminator for KeyValuePair table rows */
export const KeyValuePairTypeValues = ['CONFIG_VARIABLE', 'USER_VARIABLE'] as const
export type KeyValuePairType = (typeof KeyValuePairTypeValues)[number]

export const KeyValuePairType = {
  CONFIG_VARIABLE: 'CONFIG_VARIABLE',
  USER_VARIABLE: 'USER_VARIABLE',
} as const

// ============================================================================
// CONFIG VARIABLE ENUMS
// ============================================================================

/** Value types for config variables */
export const ConfigVariableTypeValues = ['STRING', 'NUMBER', 'BOOLEAN', 'ENUM', 'ARRAY'] as const
export type ConfigVariableType = (typeof ConfigVariableTypeValues)[number]

export const ConfigVariableType = {
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  ENUM: 'ENUM',
  ARRAY: 'ARRAY',
} as const

/** Grouping for config variable UI */
export const ConfigVariableGroupValues = [
  'SERVER',
  'DATABASE',
  'REDIS',
  'AUTH',
  'GOOGLE_WORKSPACE',
  'OUTLOOK',
  'FACEBOOK',
  'DROPBOX',
  'EMAIL',
  'STORAGE',
  'AI',
  'SHOPIFY',
  'BILLING',
  'REALTIME',
  'ANALYTICS',
  'CACHE',
  'WORKER',
  'FRONTEND',
] as const
export type ConfigVariableGroup = (typeof ConfigVariableGroupValues)[number]

export const ConfigVariableGroup = {
  SERVER: 'SERVER',
  DATABASE: 'DATABASE',
  REDIS: 'REDIS',
  AUTH: 'AUTH',
  GOOGLE_WORKSPACE: 'GOOGLE_WORKSPACE',
  OUTLOOK: 'OUTLOOK',
  FACEBOOK: 'FACEBOOK',
  DROPBOX: 'DROPBOX',
  EMAIL: 'EMAIL',
  STORAGE: 'STORAGE',
  AI: 'AI',
  SHOPIFY: 'SHOPIFY',
  BILLING: 'BILLING',
  REALTIME: 'REALTIME',
  ANALYTICS: 'ANALYTICS',
  CACHE: 'CACHE',
  WORKER: 'WORKER',
  FRONTEND: 'FRONTEND',
} as const

/** Where the active value came from */
export const ConfigSourceValues = ['DATABASE', 'ENVIRONMENT', 'SST_RESOURCE', 'DEFAULT'] as const
export type ConfigSource = (typeof ConfigSourceValues)[number]

export const ConfigSource = {
  DATABASE: 'DATABASE',
  ENVIRONMENT: 'ENVIRONMENT',
  SST_RESOURCE: 'SST_RESOURCE',
  DEFAULT: 'DEFAULT',
} as const
