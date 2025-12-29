// apps/web/src/app/(protected)/app/workflows/layout.tsx

import { type ReactNode } from 'react'
import { WorkflowRegistryInitializer } from './_components/workflow-registry-initializer'

interface WorkflowsLayoutProps {
  children: ReactNode
}

/**
 * Layout for all workflow-related pages
 * Ensures the unified node registry is initialized before any workflow components load
 */
export default function WorkflowsLayout({ children }: WorkflowsLayoutProps) {
  return (
    <>
      <WorkflowRegistryInitializer />
      {children}
    </>
  )
}
