// packages/workflow-nodes/src/types/unified-config.ts

/**
 * Unified configuration schema for workflow nodes
 * Drives both backend execution and frontend UI generation
 */

// Core field types (standard HTML inputs)
export type StandardFieldType =
  | 'input' // <Input />
  | 'textarea' // <Textarea />
  | 'select' // <Select />
  | 'checkbox' // <Checkbox />
  | 'number' // <Input type="number" />
  | 'datetime' // <Input type="datetime-local" />
  | 'password' // <Input type="password" />
  | 'email' // <Input type="email" />
  | 'url' // <Input type="url" />

// Special component keywords (to be implemented later)
export type SpecialFieldType =
  | '@integration/credential-selector'
  | '@workflow/variable-selector'
  | '@workflow/node-output-selector'
  | '@data/json-editor'

export type FieldType = StandardFieldType | SpecialFieldType

/**
 * Validation rules for fields
 */
export interface ValidationRule {
  type: 'required' | 'minLength' | 'maxLength' | 'min' | 'max' | 'pattern' | 'email' | 'url'
  value?: string | number
  message: string
}

/**
 * Conditional display rules
 */
export interface ConditionalRule {
  field: string
  operator: 'equals' | 'not_equals' | 'in' | 'not_in'
  value: any
}

/**
 * Select field option
 */
export interface SelectOption {
  name: string
  value: string
  description?: string
}

/**
 * Field configuration
 */
export interface FieldConfig {
  id: string
  name: string // Property name for backend
  type: FieldType
  title: string
  description?: string
  required?: boolean
  placeholder?: string
  default?: any

  // Field-specific properties
  options?: SelectOption[] // For select fields
  rows?: number // For textarea fields
  min?: number // For number fields
  max?: number // For number fields

  // Validation
  validation?: ValidationRule[]

  // Conditional display
  showWhen?: ConditionalRule[]

  // Custom props (passed through to components)
  props?: Record<string, any>
}

/**
 * Section configuration
 */
export interface SectionConfig {
  id: string
  title: string
  description?: string
  type: 'section'
  required?: boolean
  showWhen?: ConditionalRule[]
  children: FieldConfig[]
}

/**
 * UI configuration
 */
export interface UIConfig {
  sections: SectionConfig[]
}

/**
 * Node metadata
 */
export interface NodeMetadata {
  id: string
  name: string // Backend node name
  displayName: string // Frontend display name
  description: string
  icon: string // SVG filename
  color?: string // Hex color
  category: 'integration' | 'action' | 'trigger' | 'data' | 'flow' | 'ai'
  version: string
  group?: string[] // Backend groups
}

/**
 * Backend execution configuration
 */
export interface ExecutionConfig {
  credentials?: Array<{
    name: string
    required?: boolean
  }>
  defaultVersion?: number
  canRunSingle?: boolean
}

/**
 * Frontend visual configuration
 */
export interface VisualConfig {
  width?: number
  height?: number | 'auto'
  preview?: {
    contentField?: string // Field to show in node preview
    typeField?: string // Field that determines preview type
    actionField?: string // Field that shows action badge
  }
}

/**
 * Main unified configuration interface
 */
export interface UnifiedNodeConfig {
  node: NodeMetadata
  ui: UIConfig
  execution?: ExecutionConfig
  visual?: VisualConfig
}

/**
 * Type guards
 */
export function isStandardFieldType(type: string): type is StandardFieldType {
  const standardTypes: StandardFieldType[] = [
    'input',
    'textarea',
    'select',
    'checkbox',
    'number',
    'datetime',
    'password',
    'email',
    'url',
  ]
  return standardTypes.includes(type as StandardFieldType)
}

export function isSpecialFieldType(type: string): type is SpecialFieldType {
  return type.startsWith('@')
}

/**
 * Utility function to validate configuration
 */
export function validateNodeConfig(config: UnifiedNodeConfig): string[] {
  const errors: string[] = []

  // Validate node metadata
  if (!config.node.id) errors.push('node.id is required')
  if (!config.node.name) errors.push('node.name is required')
  if (!config.node.displayName) errors.push('node.displayName is required')

  // Validate UI sections
  if (!config.ui?.sections?.length) {
    errors.push('At least one UI section is required')
  }

  // Validate fields
  config.ui?.sections?.forEach((section, sIndex) => {
    if (!section.children?.length) {
      errors.push(`Section ${sIndex} must have at least one field`)
    }

    section.children?.forEach((field, fIndex) => {
      if (!field.id) errors.push(`Section ${sIndex}, field ${fIndex}: id is required`)
      if (!field.name) errors.push(`Section ${sIndex}, field ${fIndex}: name is required`)
      if (!field.type) errors.push(`Section ${sIndex}, field ${fIndex}: type is required`)
      if (!field.title) errors.push(`Section ${sIndex}, field ${fIndex}: title is required`)

      // Validate select options
      if (field.type === 'select' && !field.options?.length) {
        errors.push(`Section ${sIndex}, field ${fIndex}: select field must have options`)
      }
    })
  })

  return errors
}
