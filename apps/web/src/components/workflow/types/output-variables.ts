// apps/web/src/components/workflow/types/output-variables.ts

import type { Resource } from '@auxx/lib/resources/client'
import type { WorkflowBlockField } from '~/lib/workflow/types'
import type { UnifiedVariable } from './variable-types'

/**
 * Represents an output variable that a node exposes to downstream nodes
 */
export interface OutputVariable {
  /** Variable name (e.g., 'text', 'structured_output') */
  name: string

  /** Variable type (e.g., 'string', 'number', 'object', 'array', 'reference') */
  type: string // Keep for backward compatibility

  /** Human-readable description of the variable */
  description: string

  /** Optional JSON schema for complex types */
  schema?: any

  /** Whether this output is always available */
  required?: boolean

  /** Example value for documentation */
  example?: any

  /** For dynamic outputs, conditions when available */
  condition?: string
}

/**
 * Context passed to outputVariables functions for resource access and upstream variable resolution
 */
export interface OutputVariableContext {
  /** Resource for this node (if resourceType is set) */
  resource?: Resource
  /** All available resources */
  allResources: Resource[]
  /** Resolve any upstream variable by ID. Returns undefined if not yet computed. */
  resolveVariable: (variableId: string) => UnifiedVariable | undefined
}

/**
 * Function type that returns UnifiedVariable[] for node outputs
 *
 * @param config - Node configuration data
 * @param nodeId - Node ID
 * @param context - Output variable context with resource access and variable resolver
 */
export type UnifiedOutputVariablesFunction<TConfig = any> = (
  config: TConfig,
  nodeId: string,
  context: OutputVariableContext
) => UnifiedVariable[]

/**
 * Helper to create a simple output variable
 */
export function createOutputVariable(
  name: string,
  type: string,
  description: string,
  options?: Partial<OutputVariable>
): OutputVariable {
  return { name, type, description, required: true, ...options }
}

/**
 * Props for the OutputVariablesDisplay component
 */
export interface OutputVariablesDisplayProps {
  /**
   * Array of output variables from the node (for built-in nodes)
   */
  outputVariables?: UnifiedVariable[]

  /**
   * Output fields from app block schema (for app workflow blocks)
   * Will be converted to UnifiedVariables internally
   */
  outputs?: Record<string, WorkflowBlockField>

  /**
   * Node ID (required when using outputs parameter)
   */
  nodeId?: string

  /**
   * Optional custom title for the section
   */
  title?: string

  /**
   * Optional custom description for the section
   */
  description?: string

  /**
   * Whether the section should be initially open
   */
  initialOpen?: boolean

  /**
   * Optional className for styling
   */
  className?: string
}

/**
 * Transformed variable structure for display
 */
export interface DisplayVariable {
  name: string
  type: string
  description?: string
  subItems?: DisplayVariable[]
}
