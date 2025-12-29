// packages/lib/src/import/types/resolution.ts

/** All supported resolution types */
export type ResolutionType =
  | 'text:value' // Plain text
  | 'text:cuid' // Parse as cuid2 ID (for matching existing records)
  | 'number:integer' // Parse integer
  | 'number:decimal' // Parse decimal
  | 'date:iso' // ISO date
  | 'date:custom' // Custom date format
  | 'datetime:iso' // ISO datetime
  | 'datetime:custom' // Custom datetime format
  | 'boolean:truthy' // Boolean parsing
  | 'email:value' // Email validation
  | 'phone:value' // Phone normalization
  | 'select:value' // Match enum option
  | 'select:create' // Match or create enum
  | 'multiselect:split' // Split and match
  | 'relation:id' // CSV contains the target record's ID directly
  | 'relation:match' // Match related record by a field value (e.g., name, email)
  | 'relation:create' // Match or create related record if not found
  | 'domain:value' // Parse domain
  | 'array:split' // Split to array

/** Configuration for resolution */
export interface ResolutionConfig {
  dateFormat?: string
  timestampFormat?: string
  numberDecimalSeparator?: string
  arraySeparator?: string
  enumValues?: Array<{ dbValue: string; label: string }>

  /** Relation resolution config (from ResourceRegistryService) */
  relationConfig?: {
    targetTable: string // e.g., 'contact', 'entity_product'
    matchField?: string // Field to match on (defaults to displayNameField)
    cardinality: 'one-to-many' | 'many-to-one'
  }
}

/** Result of resolving a value */
export interface ResolvedValue {
  type: 'value' | 'error' | 'warning' | 'create'
  value?: unknown
  error?: string
  warning?: string
}

/** Resolution result for a single raw value */
export interface ResolutionResult {
  rawValue: string
  hashedValue: string
  resolvedValues: ResolvedValue[]
  isValid: boolean
  error?: string
}

/** Cached value resolution record */
export interface ValueResolution {
  id: string
  importJobPropertyId: string
  hashedValue: string
  rawValue: string
  cellCount: number
  resolvedValues: ResolvedValue[]
  isValid: boolean
  errorMessage?: string
}

/** Unique value with occurrence count */
export interface UniqueValue {
  rawValue: string
  hash: string
  count: number
}

/** Override value for user corrections */
export interface OverrideValue {
  type: 'value' | 'create' | 'skip'
  value: string
  id?: string // For relationships - the resolved entity ID
}

/** Field configuration for value editing */
export interface ColumnFieldConfig {
  key: string
  type: string // BaseType: 'text', 'number', 'enum', 'relationship', etc.
  resolutionType: string // e.g., 'select:value', 'relation:match'
  enumValues?: Array<{ dbValue: string; label: string }>
  relationConfig?: {
    targetTable: string
    cardinality: 'one-to-many' | 'many-to-one'
  }
}
