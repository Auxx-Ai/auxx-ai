// apps/web/src/app/(protected)/app/workflows/_components/workflow-registry-initializer.tsx
'use client'

import { useEffect } from 'react'
import { setupNodeRegistry } from '~/components/workflow/nodes/registry-setup'

/**
 * Component that initializes the unified node registry when workflows are accessed
 * This ensures all node definitions (including triggers) are registered before
 * any workflow components try to access them
 */
export function WorkflowRegistryInitializer() {
  useEffect(() => {
    // Initialize the node registry on mount
    setupNodeRegistry()
  }, [])

  // This component doesn't render anything, it just initializes the registry
  return null
}
