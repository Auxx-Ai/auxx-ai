// apps/web/src/components/workflow/index.ts

// Canvas components
export { WorkflowCanvas } from './canvas/workflow-canvas'
export { WorkflowToolbar } from './canvas/workflow-toolbar'
// Main editor component
export { WorkflowEditor } from './editor/workflow-editor'

// export { NodePalette } from './canvas/node-palette'

// Panel components
// export { PropertyPanel } from './panels/property-panel'
// export { VariablePanel } from './panels/variable-panel'
// export { DebugPanel } from './panels/debug-panel'

// Node system exports
export * from './nodes'
// Store exports
export * from './store'

// Types
export type { FlowEdge, FlowNode } from './store/types'
