// packages/lib/src/workflow-engine/resources/registry/field-types.ts

import { BaseType } from '../types'
import type { TargetTimeInStatus } from '@auxx/services/custom-fields'
import type { FieldType } from '@auxx/database/types'
import type { FieldOptions } from '../../field-values/converters'

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
  /** Color name for UI (e.g., 'blue', 'indigo', 'gray') */
  readonly color: string
  /** API slug (e.g., 'tickets', 'contacts') */
  readonly apiSlug: string
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
  /** Can set field value in CRUD update operation */
  updatable: boolean
  /** Can edit field definition (name, type, description, etc.) */
  configurable: boolean
  /** Required for create operation */
  required?: boolean
  /** Field must contain unique values */
  unique?: boolean
  /** Field is computed/derived and cannot be directly set */
  computed?: boolean
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
 * Unified field definition
 * Single source of truth for all resource field metadata
 */
export interface ResourceField {
  /**
   * Database field ID for custom entity fields.
   * Used in CRUD operations and SQL queries against CustomFieldValue.fieldId.
   * Only populated for custom entity fields; undefined for system resource fields.
   */
  id: string

  /** Field identifier for variable paths (e.g., 'title', 'status', 'Colors1') */
  key: string
  /** Display label for UI */
  label: string
  /** Field data type (for workflow engine: 'string', 'number', 'object', 'array', etc.) */
  type: BaseType

  /**
   * Original FieldType from CustomField (e.g., 'TEXT', 'RELATIONSHIP', 'EMAIL')
   * Used for determining value storage type (which columns store the value).
   * Different from type: type is for workflow engine (BaseType),
   * fieldType is for storage and value extraction (FieldType enum).
   * @optional - populated for custom entity fields, undefined for system resource fields
   */
  fieldType?: FieldType

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

  // Field options (display options, currency config, etc.)
  /** Field options from CustomField.options - contains display options (checkboxStyle, decimals, format, etc.) */
  options?: FieldOptions

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
  /** Relationship configuration for RELATION type fields - matches database schema */
  relationship?: FieldOptions['relationship']

  /**
   * Relationship field configuration for EntitySeeder
   * Used to create relationship field pairs (primary + inverse) during seeding.
   * Only needed for system relationship fields that need to be seeded.
   */
  relationshipConfig?: {
    /** Target entity type (e.g., 'contact', 'user', 'ticket') */
    relatedEntityType: string
    /** Relationship type ('belongs_to', 'has_many', 'has_one') */
    relationshipType: 'belongs_to' | 'has_many' | 'has_one'
    /** Display name for the inverse field (e.g., 'Tickets', 'Assigned Tickets') */
    inverseName: string
    /** System attribute for the inverse field (e.g., 'contact_tickets', 'user_assigned_tickets') */
    inverseSystemAttribute: string
  }

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

  // ─────────────────────────────────────────────────────────────
  // CONVENIENCE PROPERTIES (for unified consumption, avoid transforms)
  // ─────────────────────────────────────────────────────────────

  /** Human-readable name (alias for 'label' for consumer compatibility) */
  name?: string

  /** Explicit sort order for field lists (lexicographic string for fractional indexing) */
  sortOrder?: string

  /** Whether field is currently active/visible (default: true) */
  active?: boolean

  /** Whether field must contain unique values (convenience for capabilities.unique) */
  isUnique?: boolean

  /** Whether field is required (convenience for capabilities.required) */
  required?: boolean

  // ─────────────────────────────────────────────────────────────
  // SYSTEM FIELD PROPERTIES (for unified field handling)
  // ─────────────────────────────────────────────────────────────

  /**
   * True for system/built-in fields that exist on the database table.
   * False or undefined for custom fields defined via CustomField entity.
   */
  isSystem?: boolean

  /**
   * Key for dynamic options loading. Maps to DYNAMIC_OPTIONS_REGISTRY.
   * Example: 'contactGroups' loads customer groups via tRPC
   */
  dynamicOptionsKey?: string

  /**
   * For computed/display fields: source fields to combine.
   * Example: name field with sourceFields: ['firstName', 'lastName']
   * Used for hydration to build composite value object.
   */
  sourceFields?: string[]

  /**
   * For computed fields: target fields to update when saving.
   * Example: name field with targetFields: ['firstName', 'lastName']
   * The input component must handle splitting the value.
   */
  targetFields?: string[]

  /**
   * Sort order within system fields (lower = higher priority).
   * Custom fields use their own sortOrder from CustomField entity.
   */
  systemSortOrder?: number

  /**
   * Whether to show this field in the property panel.
   * Default: true. Set to false for relationship reverse-fields, internal fields, etc.
   */
  showInPanel?: boolean

  /**
   * System attribute identifier
   * - If set: System field (cannot delete/edit, special rendering)
   * - If null/undefined: Custom field (can delete/edit, generic rendering)
   *
   * Examples: 'primary_email', 'first_name', 'ticket_number'
   *
   * This is used by:
   * - EntitySeeder to create CustomField records
   * - Frontend to determine if field is editable
   * - Validation hooks to apply special behavior
   *
   * NOTE: isSystem can be derived: isSystem = !!systemAttribute
   */
  systemAttribute?: string
}

/**
 * Resource field registry type
 * Maps resource types to their field definitions
 */
export type ResourceFieldRegistry = Record<string, Record<string, ResourceField>>
