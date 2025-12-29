// apps/web/src/components/workflow/store/types.ts

import type { WorkflowExecutionResult } from '@auxx/lib/workflow-engine/types'
// Import consolidated types
import type {
  FlowNode as BaseFlowNode,
  FlowEdge as BaseFlowEdge,
} from '~/components/workflow/types'

/**
 * Common options for store operations
 */
export interface HistoryOptions {
  skipHistory?: boolean
}

/**
 * Variable definition for nodes
 */
export interface NodeVariable {
  variable: string
  label: string
  type: 'text-input' | 'number' | 'select' | 'textarea'
  max_length?: number
  required?: boolean
  options?: string[]
}

/**
 * Re-export consolidated types for backward compatibility
 * @deprecated Use imports from ~/components/workflow/types instead
 */
export type FlowNode = BaseFlowNode
export type FlowEdge = BaseFlowEdge

/**
 * History entry for undo/redo functionality
 */
export interface HistoryEntry {
  id: string
  timestamp: number
  action: string
  store: string
  data: any
  label?: string
  batch?: string
}

/**
 * User presence information for collaboration
 */
export interface UserPresence {
  userId: string
  userName: string
  color: string
  cursor?: { x: number; y: number }
  selectedNodes?: string[]
  lastActive: Date
}

/**
 * Environment variable definition for workflow export
 */
export interface EnvironmentVariable {
  id: string
  name: string
  value: any
  value_type: 'string' | 'number' | 'boolean' | 'array' | 'secret'
}

/**
 * Variable definition for workflow execution
 */
export interface Variable {
  id?: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'
  value: any
  scope: 'global' | 'workflow' | 'local'
  description?: string
  isSystem?: boolean
}

/**
 * Debug log entry
 */
export interface DebugLogEntry {
  id: string
  timestamp: Date
  nodeId?: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  data?: any
}

/**
 * Panel state
 */
export interface PanelState {
  activePanel: 'properties' | 'variables' | 'debug' | 'history' | null
  panelData?: any
  isPanelOpen: boolean
  panelWidth: number
  isPinned: boolean
}

/**
 * Canvas view state
 */
export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

/**
 * Selection state
 */
export interface SelectionState {
  nodes: Set<string>
  edges: Set<string>
}

/**
 * Node update for batch operations
 */
export interface NodeUpdate {
  id: string
  updates: Partial<FlowNode>
}

/**
 * Edge update for batch operations
 */
export interface EdgeUpdate {
  id: string
  updates: Partial<FlowEdge>
}

/**
 * Workflow metadata
 */
export interface WorkflowMetadata {
  id: string
  name: string
  description?: string
  version: number
  lastModified: Date
  createdBy?: { id: string; name: string; email: string }
  tags?: string[]
}

/**
 * Drag state for performance optimization
 */
export interface DragState {
  isDragging: boolean
  draggedNodes: Set<string>
  dragStartTime?: number
  dragMode: 'single' | 'multi' | null
}

/**
 * Store event types
 */
export type StoreEvent =
  | { type: 'selection:changed'; data: { nodes: string[]; edges: string[] } }
  | { type: 'node:added'; data: { node: FlowNode } }
  | { type: 'node:updated'; data: { nodeId: string; updates: Partial<FlowNode> } }
  | { type: 'node:deleted'; data: { nodeId: string } }
  | { type: 'edge:added'; data: { edge: FlowEdge } }
  | { type: 'edge:updated'; data: { edgeId: string; updates: Partial<FlowEdge> } }
  | { type: 'edge:deleted'; data: { edgeId: string } }
  | { type: 'variable:changed'; data: { variable: Variable } }
  | { type: 'execution:started'; data: { executionId: string } }
  | { type: 'execution:completed'; data: { result: WorkflowExecutionResult } }
  | { type: 'history:changed'; data: { canUndo: boolean; canRedo: boolean } }
  | { type: 'interaction:modeChanged'; data: { mode: 'pointer' | 'pan' } }
  | { type: 'clipboard:copied'; data: { nodeCount: number; edgeCount: number } }
  | { type: 'clipboard:cleared'; data: {} }
  | { type: 'nodes:pasted'; data: { nodeCount: number; edgeCount: number; nodes: FlowNode[] } }
  | { type: 'drag:started'; data: { nodeIds: string[] } }
  | { type: 'drag:ended'; data: { nodeIds: string[]; duration: number } }

/**
 * Preferences for the workflow editor
 */
export interface WorkflowPreferences {
  theme: 'light' | 'dark' | 'auto'
  gridSnap: boolean
  gridSize: number
  showMinimap: boolean
  showDebugInfo: boolean
  autoSave: boolean
  autoSaveInterval: number
  connectionMode: 'loose' | 'strict'
}
