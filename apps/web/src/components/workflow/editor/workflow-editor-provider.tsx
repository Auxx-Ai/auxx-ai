// apps/web/src/components/workflow/editor/workflow-editor-provider.tsx

import type React from 'react'
import { createContext, useCallback, useContext, useEffect } from 'react'
import { setupNodeRegistry } from '../nodes/registry-setup'
import type { FlowEdge, FlowNode } from '../store/types'

interface WorkflowEditorContextValue {
  // Initial data for ReactFlow state initialization
  getInitialNodes: () => FlowNode[]
  getInitialEdges: () => FlowEdge[]
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
