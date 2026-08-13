// packages/lib/src/workflow-engine/types/unified-variable.ts

import type { ResourceFieldId } from '@auxx/types/field'
import type { FieldOptions } from '../../field-values/converters'
import type { BaseType } from '../core/types'

/**
 * Validation rules for type values
 */
export interface ValidationRules {
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  pattern?: string | RegExp
  custom?: (value: any) => boolean | string
}

/**
 * One entry of a variable picker's `allowedTypes` / `expectedTypes` filter.
 *
 * Either a {@link BaseType}, or a **resource identifier** used to filter
 * relation/reference variables. That identifier is not restricted to the system
 * `TableId` union — it may equally be an `EntityDefinition` id or a resource
 * slug, which `isVariableTypeCompatible` cross-resolves through the resource
 * store. Hence `string` rather than `TableId`.
 */
export type AllowedVarType = BaseType | string

/**
 * Unified variable type that merges all legacy variable formats.
 * The single source of truth for variables across the workflow system —
 * declared by node output resolvers, consumed by the variable picker and the
 * execution context.
 */
export interface UnifiedVariable {
  // Core identification
  id: string // Unique identifier (full path: "node-123.content", "env.API_KEY")
  nodeId?: string

  // Display information
  label: string // Human-readable label
  description?: string // Optional description

  type: BaseType // Base type from unified type system

  // ─────────────────────────────────────────────────────────────
  // FIELD REFERENCE (typed, replaces untyped `reference`)
  // ─────────────────────────────────────────────────────────────

  /**
   * Typed field reference using ResourceFieldId system.
   * Format: `${entityDefinitionId}:${fieldId}`
   *
   * Examples:
   * - "contact:email" (system field on contact)
   * - "ticket:cm1abc123xyz" (custom field on ticket)
   *
   * Use parseResourceFieldId() to extract components - NO manual .split(':')
   */
  fieldReference?: ResourceFieldId

  /**
   * For direct resource references (e.g., "contact", "ticket")
   * When the variable IS a resource, not a field ON a resource.
   */
  resourceId?: string

  /**
   * Field options using unified FieldOptions structure.
   * Same format as custom fields for consistency.
   */
  options?: FieldOptions

  /**
   * Allowed values for `BaseType.ENUM` variables.
   *
   * Sourced from a JSON Schema `enum`, which permits both strings and numbers —
   * see `schemaToUnifiedVariable` in apps/web utils/schema-to-variable.ts.
   */
  enum?: (string | number)[]

  // ─────────────────────────────────────────────────────────────
  // STRUCTURAL TYPES
  // ─────────────────────────────────────────────────────────────

  // For arrays: type of items
  items?: UnifiedVariable // Replaces itemType, now recursive

  // For objects: property definitions with key preservation
  properties?: Record<string, UnifiedVariable> // Object properties by key

  // ─────────────────────────────────────────────────────────────
  // METADATA
  // ─────────────────────────────────────────────────────────────

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
