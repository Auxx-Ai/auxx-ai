// apps/web/src/components/workflow/types/registry.ts

import type { WorkflowTriggerType } from '@auxx/lib/workflow-engine/types'
import type { ComponentType } from 'react'
import type { UnifiedOutputVariablesFunction } from './output-variables'

// Simplified typing approach to avoid Zod complexity

/**
 * UI node categories for organization
 */
export enum NodeCategory {
  TRIGGER = 'trigger',
  INPUT = 'input',
  CONDITION = 'condition',
  ACTION = 'action',
  TRANSFORM = 'transform',
  FLOW_CONTROL = 'flow_control',
  DATA = 'data',
  DATASET = 'dataset',
  INTEGRATION = 'integration',
  AI = 'ai',
  DEBUG = 'debug',
  UTILITY = 'utility',
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean
  errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }>
}

/**
 * Node panel component props
 */
export interface NodePanelProps {
  nodeId: string
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
  panel?: ComponentType<NodePanelProps> // Panel component for the node
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
