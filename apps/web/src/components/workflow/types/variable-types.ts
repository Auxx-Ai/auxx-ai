// apps/web/src/components/workflow/types/variable-types.ts

import type { TableId, UnifiedVariable } from '@auxx/lib/workflow-engine/client'

// UnifiedVariable and AllowedVarType moved to lib (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/types/unified-variable`) so node manifests and
// server-side output resolution can share them. Re-exported here so the ~100
// existing web imports keep working; the React-carrying picker/UI types below
// stay in this file.
export type { AllowedVarType, UnifiedVariable } from '@auxx/lib/workflow-engine/client'
export { BaseType } from './unified-types'

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
