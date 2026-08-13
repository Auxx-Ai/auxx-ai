// apps/web/src/components/workflow/types/registry.ts

import type { WorkflowNodeExecutionEntity } from '@auxx/database/types'
import type {
  NodeCategory,
  NodeValidationResult as ValidationResult,
  WorkflowTriggerType,
} from '@auxx/lib/workflow-engine/client'
import type { ComponentType } from 'react'
import type { BaseNodeData } from './node-base'
import type { UnifiedOutputVariablesFunction } from './output-variables'

// Simplified typing approach to avoid Zod complexity

export type { NodeValidationResult as ValidationResult } from '@auxx/lib/workflow-engine/client'
// NodeCategory and ValidationResult relocated to the lib node catalog
// (node-catalog Phase 1 — `@auxx/lib/workflow-engine/catalog/types`), where
// they are the manifest's category and validator-result types. Re-exported
// here so no web import churns; lib names the validator result
// `NodeValidationResult` to avoid colliding with the engine's own
// whole-workflow `ValidationResult`.
export { NodeCategory } from '@auxx/lib/workflow-engine/client'

/**
 * Props every node configuration panel receives.
 *
 * `PropertyPanel` (workflow/panels/property-panel.tsx) is the only mount site and
 * it always passes BOTH the selected node's id and its data — the panels have
 * always destructured `data`, the slot type just never admitted it.
 */
export interface NodePanelProps<TData = BaseNodeData> {
  nodeId: string
  data: TData
}

/**
 * Props for a node type's trace ("Preview") renderer
 */
export interface TraceRendererProps {
  /** The node execution being inspected (outputs, metadata, status, error). */
  execution: WorkflowNodeExecutionEntity
}

/**
 * Node definition for the registry (flattened data version)
 */
export interface NodeDefinition<TData = any> {
  id: string
  category: NodeCategory
  subcategory?: string // Optional subcategory for grouping within a category (e.g., for app blocks)
  displayName: string
  description: string
  icon: string
  getIcon?: (data: TData) => string // Dynamic icon based on node data (optional)
  color?: string
  defaultData: Partial<TData> // Default data for the node (flattened structure)
  schema: any // Simplified to avoid Zod typing complexity
  component?: ComponentType<any> // The React component to render this node (for dynamic lookup)
  panel?: ComponentType<NodePanelProps<TData>> // Panel component for the node
  /** Optional pretty renderer for this node type's execution output ("Preview" trace tab). */
  traceRenderer?: ComponentType<TraceRendererProps>
  validator?: (data: TData) => ValidationResult // Validation function
  triggerType?: WorkflowTriggerType // Only set for trigger nodes
  canConnect?: boolean // Whether this node can connect to other nodes (default: true)
  canRunSingle?: boolean // Whether this node can be run individually (default: false)
  extractVariables?: (data: TData) => Array<any> // Extract variables from node data
  getRequiredInputSchemas?: () => string[] // Get required input schema names
  outputVariables: UnifiedOutputVariablesFunction<TData> // Define output variables that this node exposes
  availableNextNodes?: string[] // Node types this node can connect to
  availablePrevNodes?: string[] // Node types that can connect to this node
  maxOutgoingConnections?: number // Max outgoing connections (default: unlimited)
  maxIncomingConnections?: number // Max incoming connections (default: unlimited)
  acceptsInputNodes?: boolean // Whether this node accepts input node connections

  // NEW: Placeholder tracking for async-loaded app nodes
  _isPlaceholder?: boolean // Whether this is a placeholder definition
  _loadError?: string // Error message if the app node failed to load
}
