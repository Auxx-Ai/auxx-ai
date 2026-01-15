// apps/web/src/components/workflow/types/variable-types.ts

import type { ValidationRules } from './unified-types'
import { BaseType } from './unified-types'
import type { TableId } from '@auxx/lib/workflow-engine/client'

export { BaseType } from './unified-types'

/**
 * Unified variable type that merges all legacy variable formats
 * This is the single source of truth for variables across the workflow system
 */
export interface UnifiedVariable {
  // Core identification
  id: string // Unique identifier (full path: "node-123.content", "env.API_KEY")
  nodeId?: string
  // Path information
  // path: string // Relative path: "content", "from.email"

  // Display information
  label: string // Human-readable label
  description?: string // Optional description

  type: BaseType // Base type from unified type system

  // For reference types: specialized picker or resource type identifier
  // Can be TableId string (e.g., 'ticket', 'contact')
  reference?: TableId

  // For arrays: type of items
  items?: UnifiedVariable // Replaces itemType, now recursive

  // For objects: property definitions with key preservation
  properties?: Record<string, UnifiedVariable> // Object properties by key

  // For enums: allowed values
  enum?: (string | number)[]

  // Categorization
  category: 'node' | 'environment' | 'system'

  // Value constraints
  required?: boolean // Is this variable required?
  default?: any // Default value
  example?: any // Example value
  validation?: ValidationRules

  // UI hints (optional)
  icon?: string // Icon for UI display
  color?: string // Color for UI display
}

export const VAR_MODE = { PICKER: 'picker', RICH: 'rich' } as const
export type VarMode = (typeof VAR_MODE)[keyof typeof VAR_MODE]

/**
 * Variable group for organized display in variable explorer
 */
export interface VariableGroup {
  id: string
  // nodeId: string
  name: string // Display name for the group (user's title)
  type: 'node' | 'system' | 'environment' | 'loop'
  nodeType?: string //
  icon?: React.ReactNode // Node type icon
  order: number // For sorting (0 = most recent upstream, higher = older)
  variables: UnifiedVariable[]
  color: string
}

/**
 * Navigation state for variable explorer
 */
export interface NavigationState {
  path: string[]
  history: string[][]
}

/**
 * Category metadata for variable grouping
 */
export interface VariableCategory {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  color?: string
  description?: string
  order?: number
}

/**
 * Variable selection event
 */
export interface VariableSelectionEvent {
  variable: UnifiedVariable
  insertText: string
  source: 'click' | 'keyboard' | 'search'
}

/**
 * Metadata derived from a variable for RelationInput
 */
export interface FieldReferenceMetadata {
  fieldReference: string
  relatedEntityDefinitionId: TableId
  resourceType: string
  fieldKey: string
}
