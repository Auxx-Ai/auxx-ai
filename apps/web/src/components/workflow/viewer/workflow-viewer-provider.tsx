// apps/web/src/components/workflow/viewer/workflow-viewer-provider.tsx

'use client'

import type React from 'react'
import { createContext, useContext, useMemo } from 'react'

/**
 * Context value for workflow viewer
 */
interface WorkflowViewerContextValue {
  isReadOnly: true
}

const WorkflowViewerContext = createContext<WorkflowViewerContextValue | null>(null)

interface WorkflowViewerProviderProps {
  children: React.ReactNode
}

/**
 * Minimal provider for the workflow viewer
 * Provides read-only context to all child components
 */
export const WorkflowViewerProvider: React.FC<WorkflowViewerProviderProps> = ({ children }) => {
  const value = useMemo(() => ({ isReadOnly: true as const }), [])

  return <WorkflowViewerContext.Provider value={value}>{children}</WorkflowViewerContext.Provider>
}

/**
 * Hook to access viewer context
 */
export function useWorkflowViewerContext() {
  const context = useContext(WorkflowViewerContext)

  if (!context) {
    throw new Error('useWorkflowViewerContext must be used within a WorkflowViewerProvider')
  }

  return context
}
