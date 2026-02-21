// packages/credentials/src/config/types.ts
// Type definitions for the config variable system

import type { ConfigSource, ConfigVariableGroup, ConfigVariableType } from '@auxx/types/config'

/**
 * Metadata definition for a single config variable.
 * This is the "schema" — it describes what a variable is, not its current value.
 */
export interface ConfigVariableDefinition {
  /** The env var name, e.g. 'OPENAI_API_KEY' */
  key: string
  /** Human-readable description */
  description: string
  /** Value type for validation and UI rendering */
  type: ConfigVariableType
  /** Grouping for UI organization */
  group: ConfigVariableGroup
  /** Default value when neither DB nor env provides one */
  defaultValue?: string | number | boolean | string[]
  /** If true, value is encrypted in DB and masked in UI */
  isSensitive: boolean
  /** If true, cannot be overridden via DB — env var or default only */
  isEnvOnly: boolean
  /** For ENUM type: allowed values */
  options?: string[]
  /** Validation: for NUMBER type */
  min?: number
  max?: number
  /** Validation: regex pattern for STRING type */
  pattern?: string
}

/**
 * A config variable with its resolved value and source.
 * This is what the API returns to the frontend.
 */
export interface ResolvedConfigVariable {
  /** Variable metadata */
  definition: ConfigVariableDefinition
  /** The current resolved value (masked if sensitive) */
  value: string | number | boolean | string[] | null
  /** Where the value came from */
  source: ConfigSource
  /** Whether a DB override exists */
  hasDbOverride: boolean
}

/**
 * Grouped config variables for the admin UI.
 */
export interface ConfigVariableGroupData {
  group: ConfigVariableGroup
  label: string
  description: string
  iconId: string
  variables: ResolvedConfigVariable[]
}
