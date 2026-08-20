// apps/web/src/components/workflow/store/types.ts

import type { WorkflowExecutionResult } from '@auxx/lib/workflow-engine/client'
// Import consolidated types
import type {
  FlowEdge as BaseFlowEdge,
  FlowNode as BaseFlowNode,
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
/** The workflow node a history entry is about, named as it was AT THAT TIME. */
export interface HistorySubject {
  id: string
  /** Title when the entry was recorded — not a live lookup. */
  title: string
  /** Node type, for the badge icon. */
  nodeType?: string
}

export interface HistoryEntry {
  id: string
  timestamp: number
  action: string
  store: string
  data: any
  label?: string
  batch?: string
  /**
   * Identity of the logical edit this entry belongs to. A later record with the
   * same key overwrites this entry instead of pushing a new one — see
   * `HistoryManager.record`.
   */
  coalesceKey?: string
  /**
   * The node this entry acted on. Present only when the entry is about exactly
   * one node, so the popover can render it as a badge instead of a sentence.
   */
  subject?: HistorySubject
  /** New title, when this entry renamed {@link subject}. */
  renamedTo?: string
  /** Bare verb for badge rendering — `added`, `changed`, `moved`. */
  verb?: string
}

/**
 * The descriptive half of an entry, recomputed on every coalesced merge so a
 * label converges with the session instead of freezing at its first keystroke.
 */
export type HistoryDescription = Pick<HistoryEntry, 'label' | 'subject' | 'renamedTo' | 'verb'>

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
  | {
      type: 'workflow:externalUpdate'
      data: {
        nodes?: FlowNode[]
        edges?: FlowEdge[]
        viewport?: { x: number; y: number; zoom: number }
      }
    }

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

/**
 * The set of draft changes a save can carry.
 *
 * Lives here rather than beside the save owner so
 * {@link import('./workflow-store').useWorkflowStore}'s registered `queueSave`
 * can be typed without importing a React provider into a zustand store.
 */
export interface WorkflowPendingChanges {
  graph?: boolean
  name?: string
  description?: string
  icon?: { iconId: string; color: string }
  webEnabled?: boolean
  apiEnabled?: boolean
  accessMode?: 'public' | 'organization'
  config?: Record<string, unknown>
  rateLimit?: Record<string, unknown>
  envVars?: boolean
}
