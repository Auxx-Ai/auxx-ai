// apps/web/src/components/workflow/index.ts

// Main editor component
export { WorkflowEditor } from './editor/workflow-editor'

// Canvas components
export { WorkflowCanvas } from './canvas/workflow-canvas'
export { WorkflowToolbar } from './canvas/workflow-toolbar'
// export { NodePalette } from './canvas/node-palette'

// Panel components
// export { PropertyPanel } from './panels/property-panel'
// export { VariablePanel } from './panels/variable-panel'
// export { DebugPanel } from './panels/debug-panel'

// Store exports
export * from './store'

// Node system exports
export * from './nodes'

// Types
export type { FlowNode, FlowEdge } from './store/types'
