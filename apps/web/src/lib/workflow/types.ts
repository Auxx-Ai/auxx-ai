// apps/web/src/lib/workflow/types.ts

/**
 * Layout section for auto-generated panels
 */
export interface WorkflowLayoutSection {
  type: 'section'
  title: string
  description?: string
  fields: string[]
  collapsible?: boolean
  initialOpen?: boolean
}

/**
 * Workflow block definition from an app
 */
export interface WorkflowBlock {
  id: string
  appId: string
  installationId: string
  label: string
  description?: string
  category: string
  icon?: string
  color?: string
  schema: {
    inputs: Record<string, WorkflowBlockInput> // Object format: { fieldName: fieldDefinition }
    outputs: Record<string, WorkflowBlockOutput> // Object format: { fieldName: fieldDefinition }
    handles?: {
      sources?: Array<{ id: string; label?: string }>
      targets?: Array<{ id: string; label?: string }>
    }
    layout?: WorkflowLayoutSection[]
    validation?: {
      custom?: (data: any) => {
        valid: boolean
        errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }>
      }
    }
  }
  config?: {
    canRunSingle?: boolean
    requiresConnection?: boolean
    polling?: {
      intervalMinutes?: number
      cron?: string
      minIntervalMinutes?: number
    }
  }
  /** Whether this block has a custom panel component */
  hasPanel?: boolean
  components?: {
    node?: any
    panel?: any
  }
}

/**
 * Unified workflow block field definition.
 *
 * Used for both inputs and outputs to maintain consistency.
 * This replaces the separate WorkflowBlockInput and WorkflowBlockOutput interfaces.
 *
 * Design principles:
 * - All fields are optional except name, label, and type
 * - Input-specific fields (placeholder, acceptsVariables) are ignored for outputs
 * - Full metadata available for both inputs and outputs
 * - Supports nested structures (properties for objects, items for arrays)
 */
export interface WorkflowBlockField {
  // ========================================
  // Core Properties (Required)
  // ========================================

  /** Field name (key in schema object) */
  name: string

  /** Display label shown in UI */
  label: string

  /** Field type - maps directly to SDK field types */
  type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'select'
    | 'currency'
    | 'array'
    | 'struct'
    | 'object'
    | 'any'

  // ========================================
  // Metadata (Optional)
  // ========================================

  /** Human-readable description for help text */
  description?: string

  /** Whether this field is required (inverse of isOptional) */
  required?: boolean

  /** Default value for this field */
  default?: any

  /** Format hint for specialized string types (following JSON Schema spec) */
  format?: 'date' | 'datetime' | 'time' | 'email' | 'url' | 'uri' | 'phone'

  // ========================================
  // Input-Specific (Ignored for outputs)
  // ========================================

  /** Placeholder text shown in input field */
  placeholder?: string

  /**
   * Whether this field accepts workflow variables (e.g., {{node.output}})
   * Only meaningful for input fields
   */
  acceptsVariables?: boolean

  /** Allowed variable types when acceptsVariables is true */
  variableTypes?: string[]

  // ========================================
  // Validation Constraints
  // ========================================

  /** Minimum value (for numbers) or minimum length (for strings/arrays) */
  min?: number

  /** Maximum value (for numbers) or maximum length (for strings/arrays) */
  max?: number

  /** Minimum string length (for strings only) */
  minLength?: number

  /** Maximum string length (for strings only) */
  maxLength?: number

  /** Validation regex pattern (as string) */
  pattern?: string

  /** Integer constraint (for numbers only) */
  integer?: boolean

  /** Decimal precision (for numbers only) */
  precision?: number

  // ========================================
  // Select/Enum Fields
  // ========================================

  /** Options for select/enum fields */
  options?: readonly (string | { value: string; label: string })[]

  /** Whether this select field allows multiple selections */
  multi?: boolean

  /** Allow user to create new options (for array multi-select) */
  canAdd?: boolean

  /** Allow user to edit/delete options (for array multi-select) */
  canManage?: boolean

  // ========================================
  // Nested Structures
  // ========================================

  /**
   * Nested properties for object/struct fields.
   * Each property is itself a WorkflowBlockField (recursive).
   */
  properties?: Record<string, WorkflowBlockField>

  /**
   * Item type definition for array fields.
   * Defines the schema for each array element.
   * Can be recursively nested (e.g., array of arrays, array of objects).
   */
  items?: WorkflowBlockField

  // ========================================
  // Internal/Debug
  // ========================================

  /**
   * Optional marker to distinguish field usage context.
   * Useful for debugging and development tools.
   */
  _fieldKind?: 'input' | 'output'
}

/**
 * @deprecated Use WorkflowBlockField instead
 * Kept for backward compatibility during migration
 */
export type WorkflowBlockInput = WorkflowBlockField

/**
 * @deprecated Use WorkflowBlockField instead
 * Kept for backward compatibility during migration
 */
export type WorkflowBlockOutput = WorkflowBlockField

/**
 * Workflow block registration from iframe
 */
export interface WorkflowBlockRegistration {
  appId: string
  installationId: string
  blocks: WorkflowBlock[]
}

/**
 * Connection between nodes
 */
export interface Connection {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

/**
 * Workflow variable
 */
export interface WorkflowVariable {
  variable: string
  label: string
  type: string
  nodeId: string
}
