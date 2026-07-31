// apps/web/src/components/workflow/editor/workflow-editor-provider.tsx

import type React from 'react'
import { createContext, useContext, useEffect } from 'react'
import { setupNodeRegistry } from '../nodes/registry-setup'
import type { FlowEdge, FlowNode } from '../store/types'

interface WorkflowEditorContextValue {
  // Initial data for ReactFlow state initialization.
  //
  // Optional because nothing supplies them yet: the provider below hands down an
  // empty value and both would-be consumers in `use-node-interactions.ts` are
  // still commented out. Kept declared so the intended shape isn't lost.
  getInitialNodes?: () => FlowNode[]
  getInitialEdges?: () => FlowEdge[]
}

const WorkflowEditorContext = createContext<WorkflowEditorContextValue | null>(null)

export const WorkflowEditorProvider = ({ children }: { children: React.ReactNode }) => {
  // Initialize node registry on mount
  useEffect(() => {
    setupNodeRegistry()
  }, [])

  const value = {}

  return <WorkflowEditorContext.Provider value={value}>{children}</WorkflowEditorContext.Provider>
}

export const useWorkflowEditor = () => {
  const context = useContext(WorkflowEditorContext)
  if (!context) {
    throw new Error('useWorkflowEditor must be used within a WorkflowEditorProvider')
  }
  return context
}
