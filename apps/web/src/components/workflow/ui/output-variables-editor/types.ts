// apps/web/src/components/workflow/ui/output-variables/types.ts

import type { Node } from '@auxx/lib/workflow-engine/client'
import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import type { VariableGroup } from '../../hooks/use-available-variables'

/**
 * Represents a single output variable configuration
 */
export interface OutputVariable {
  /** The name of the output variable */
  variable: string
  /** Path segments to the value in the node outputs */
  value_selector: string[]
}

/**
 * Props for the OutputVariables component
 */
export interface OutputVariablesProps {
  // Core props
  /** Current output variables */
  outputs: OutputVariable[]
  /** Callback fired when outputs change */
  onChange: (outputs: OutputVariable[]) => void

  // Variable selection props
  /** Available variables for selection */
  variables: UnifiedVariable[]
  groups: VariableGroup[]
  /** Workflow nodes for VariableTag display */
  nodes: Node[]

  // UI customization
  /** Whether the component is read-only */
  isReadOnly?: boolean
  /** Label text for the component */
  label?: string
  /** Placeholder text for variable name input */
  placeholder?: string
  /** Message shown when no outputs are defined */
  emptyStateMessage?: string
  /** Text for the add button */
  addButtonLabel?: string

  // Optional callbacks
  /** Custom validation for variable names. Return true if valid, or error message if invalid */
  onVariableNameValidation?: (name: string) => boolean | string
  /** Maximum number of outputs allowed */
  maxOutputs?: number
}
