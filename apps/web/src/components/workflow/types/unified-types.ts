// apps/web/src/components/workflow/types/unified-types.ts

/**
 * Unified Type System for Workflow Variables
 *
 * This module provides a single source of truth for type definitions
 * across the entire workflow system, replacing multiple inconsistent
 * type systems with one unified approach.
 */

// Import BaseType from backend (single source of truth)
export { BaseType } from '@auxx/lib/workflow-engine/types'

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
