// packages/lib/src/workflow-engine/resources/registry/field-types.ts

import { BaseType } from '../types'
import type { TargetTimeInStatus } from '@auxx/services/custom-fields'

/**
 * Enum value with UI metadata
 * Represents a single enum option with its database value and display label
 */
export interface EnumValue {
  /** Value stored in database (e.g., 'OPEN', 'LOW', 'ACTIVE') */
  dbValue: string
  /** Human-readable label shown in UI (e.g., 'Open', 'Low', 'Active') */
  label: string
  /** Optional description for tooltips or help text */
  description?: string
  /** Color for kanban column headers and select badges */
  color?: string
  /** Target time for items to remain in this status (kanban time tracking) */
  targetTimeInStatus?: TargetTimeInStatus
  /** Trigger celebration animation when cards move to this column (kanban) */
  celebration?: boolean
}

/**
 * Table-level metadata for a resource
 * Defines metadata about the resource table itself (not individual fields)
 */
export interface ResourceTableDefinition {
  /** Unique table identifier (e.g., 'ticket', 'contact') */
  readonly id: string
  /** Singular display label (e.g., 'Ticket', 'Contact') */
  readonly label: string
  /** Plural display label (e.g., 'Tickets', 'Contacts') */
  readonly plural: string
  /** Icon name for UI */
  readonly icon: string
  /** Database table name */
  readonly dbName: string
}

/**
 * Field capabilities - determines what operations can be performed on a field
 */
export interface FieldCapabilities {
  /** Can use in Find node filters */
  filterable: boolean
  /** Can use for ordering in Find node */
  sortable: boolean
  /** Can set in CRUD create operation */
  creatable: boolean
  /** Can set in CRUD update operation */
  updatable: boolean
  /** Required for create operation */
  required?: boolean
}

/**
 * Validation rules for a field
 */
export interface FieldValidation {
  /** Minimum value for numbers or dates */
  min?: number
  /** Maximum value for numbers or dates */
  max?: number
  /** Regex pattern for string validation */
  pattern?: string
  /** Minimum length for strings */
  minLength?: number
  /** Maximum length for strings */
  maxLength?: number
}

/**
 * Relationship cardinality types
 */
export type RelationshipCardinality =
  | 'one-to-one' // User.profile → Profile (user has one profile)
  | 'many-to-one' // Ticket.contact → Contact (many tickets → one contact)
  | 'one-to-many' // Contact.tickets → Ticket[] (one contact → many tickets)
  | 'many-to-many' // Ticket.tags → Tag[] (via join table)

/**
 * Relationship configuration for RELATION type fields
 */
export interface RelationshipConfig {
  /** Target table ID (e.g., 'contact', 'user', 'ticket') */
  targetTable: string

  /** Target field key in the related table (usually 'id') */
  targetField?: string // Default: 'id'

  /** Relationship cardinality */
  cardinality: RelationshipCardinality

  /** Reciprocal field in target table (for bidirectional navigation) */
  reciprocalField?: string

  /** Join table name (for many-to-many relationships) */
  joinTable?: string

  /** Foreign key column in join table pointing to source */
  joinSourceColumn?: string

  /** Foreign key column in join table pointing to target */
  joinTargetColumn?: string

  /** Whether the relationship is required (cannot be null) */
  required?: boolean

  /** Whether to auto-fetch related data (lazy vs eager loading) */
  autoFetch?: boolean // Default: false (lazy)

  /** Cascade behavior on delete */
  onDelete?: 'CASCADE' | 'SET_NULL' | 'RESTRICT'

  /** Cascade behavior on update */
  onUpdate?: 'CASCADE' | 'RESTRICT'
}

/**
 * Unified field definition
 * Single source of truth for all resource field metadata
 */
export interface ResourceField {
  /**
   * Database field ID for custom entity fields.
   * Used in CRUD operations and SQL queries against CustomFieldValue.fieldId.
   * Only populated for custom entity fields; undefined for system resource fields.
   */
  id?: string

  /** Field identifier for variable paths (e.g., 'title', 'status', 'Colors1') */
  key: string
  /** Display label for UI */
  label: string
  /** Field data type */
  type: BaseType

  // Database properties
  /** Database column name (if different from key) */
  dbColumn?: string
  /** Database type (e.g., 'varchar', 'text', 'timestamp') */
  dbType?: string
  /** Whether field allows NULL values in database */
  nullable?: boolean

  // Enum configuration (only for ENUM type)
  /** Available enum values with labels */
  enumValues?: EnumValue[]

  // Capabilities (what can be done with this field)
  capabilities: FieldCapabilities

  // Operator configuration
  /**
   * Optional: Override default operators for this field.
   * If not provided, operators are derived from field.type using TYPE_OPERATOR_MAP.
   *
   * Use this ONLY when:
   * 1. You want to RESTRICT operators (e.g., ID field should only allow 'is', 'is not')
   * 2. You want to ADD custom operators (e.g., special business logic operators)
   *
   * Examples:
   * - ID field: operatorOverrides: ['is', 'is not'] (restrict from default STRING operators)
   * - Status field: operatorOverrides: ['is', 'is not', 'in', 'not in'] (already default for ENUM, so not needed)
   */
  operatorOverrides?: string[]

  // UI hints
  /** Placeholder text for input fields */
  placeholder?: string
  /** Field description for help text */
  description?: string

  // Validation rules
  validation?: FieldValidation

  // Relationship configuration (REQUIRED for RELATION type)
  /** Relationship configuration for RELATION type fields */
  relationship?: RelationshipConfig

  // Default value configuration
  /**
   * Default value to use when resource type changes.
   * Applies in both create and update modes.
   * For ENUM types, should be one of the enumValues dbValue strings.
   * For other types, should match the field type (string, number, boolean, etc.).
   * Users can clear this value if the field is optional.
   * @optional
   */
  defaultValue?: unknown

  // Import identifier configuration
  /**
   * Whether this field can be used to identify/match existing records during import.
   * When true, the field can be selected as the identifier field for update strategy.
   * Typically used for unique fields like email, phone, or record numbers.
   * @optional
   */
  isIdentifier?: boolean
}

/**
 * Resource field registry type
 * Maps resource types to their field definitions
 */
export type ResourceFieldRegistry = Record<string, Record<string, ResourceField>>
